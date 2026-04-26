#include <node_api.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <uv.h>

typedef struct {
  napi_env env;
  napi_ref callback_ref;
  uv_loop_t *loop;
  uv_poll_t uv_poll_handle;
  bool started;
  bool closing;
  bool closed;
  bool wrapper_finalized;
} native_uv_poll_t;

#define NAPI_CALL_RETURN_NULL(env, call)                                      \
  do {                                                                        \
    napi_status napi_status__ = (call);                                       \
    if (napi_status__ != napi_ok) {                                           \
      return NULL;                                                            \
    }                                                                         \
  } while (0)

static void native_uv_poll_fatal_napi(const char *message) {
  napi_fatal_error("node-uv-poll", NAPI_AUTO_LENGTH, message, NAPI_AUTO_LENGTH);
}

static napi_value native_uv_poll_throw_type_error(
    napi_env env,
    const char *message) {
  napi_throw_type_error(env, NULL, message);
  return NULL;
}

static napi_value native_uv_poll_throw_uv_error(
    napi_env env,
    const char *context,
    int uv_status) {
  char message[256];
  snprintf(
      message,
      sizeof(message),
      "%s: %s (%d)",
      context,
      uv_strerror(uv_status),
      uv_status);
  napi_throw_error(env, NULL, message);
  return NULL;
}

static void native_uv_poll_maybe_free(native_uv_poll_t *poller) {
  if (poller->wrapper_finalized && poller->closed) {
    free(poller);
  }
}

static void native_uv_poll_close_cb(uv_handle_t *handle) {
  native_uv_poll_t *poller = (native_uv_poll_t *) handle->data;

  if (poller == NULL) {
    return;
  }

  poller->started = false;
  poller->closing = false;
  poller->closed = true;

  if (poller->callback_ref != NULL) {
    napi_status napi_status = napi_delete_reference(poller->env, poller->callback_ref);
    if (napi_status != napi_ok) {
      native_uv_poll_fatal_napi("Failed to delete callback reference");
    }
    poller->callback_ref = NULL;
  }

  native_uv_poll_maybe_free(poller);
}

static void native_uv_poll_finalize(
    napi_env env,
    void *finalize_data,
    void *finalize_hint) {
  native_uv_poll_t *poller = (native_uv_poll_t *) finalize_data;
  (void) env;
  (void) finalize_hint;

  if (poller == NULL) {
    return;
  }

  poller->wrapper_finalized = true;

  if (poller->closed) {
    if (poller->callback_ref != NULL) {
      napi_delete_reference(poller->env, poller->callback_ref);
      poller->callback_ref = NULL;
    }
    free(poller);
    return;
  }

  if (!poller->closing) {
    if (poller->started) {
      uv_poll_stop(&poller->uv_poll_handle);
      poller->started = false;
    }

    poller->closing = true;
    uv_close((uv_handle_t *) &poller->uv_poll_handle, native_uv_poll_close_cb);
  }
}

static native_uv_poll_t *native_uv_poll_get_this(
    napi_env env,
    napi_callback_info info,
    size_t argc,
    napi_value *argv) {
  napi_value this_arg;
  native_uv_poll_t *poller = NULL;

  NAPI_CALL_RETURN_NULL(env, napi_get_cb_info(env, info, &argc, argv, &this_arg, NULL));
  NAPI_CALL_RETURN_NULL(env, napi_unwrap(env, this_arg, (void **) &poller));

  if (poller == NULL) {
    napi_throw_error(env, NULL, "Poll handle is not initialized");
    return NULL;
  }

  return poller;
}

static void native_uv_poll_cb(uv_poll_t *handle, int status, int events) {
  native_uv_poll_t *poller = (native_uv_poll_t *) handle->data;
  napi_handle_scope scope;
  napi_value callback;
  napi_value undefined_value;
  napi_value argv[2];
  napi_value result;
  napi_value exception;
  napi_status napi_status;

  if (poller == NULL || poller->closing || poller->closed) {
    return;
  }

  napi_status = napi_open_handle_scope(poller->env, &scope);
  if (napi_status != napi_ok) {
    native_uv_poll_fatal_napi("Failed to open handle scope in uv poll callback");
  }

  napi_status = napi_get_reference_value(poller->env, poller->callback_ref, &callback);
  if (napi_status != napi_ok) {
    napi_close_handle_scope(poller->env, scope);
    native_uv_poll_fatal_napi("Failed to resolve poll callback reference");
  }

  napi_status = napi_get_undefined(poller->env, &undefined_value);
  if (napi_status != napi_ok) {
    napi_close_handle_scope(poller->env, scope);
    native_uv_poll_fatal_napi("Failed to create undefined receiver in uv poll callback");
  }

  napi_status = napi_create_int32(poller->env, status, &argv[0]);
  if (napi_status != napi_ok) {
    napi_close_handle_scope(poller->env, scope);
    native_uv_poll_fatal_napi("Failed to create status argument in uv poll callback");
  }

  napi_status = napi_create_int32(poller->env, events, &argv[1]);
  if (napi_status != napi_ok) {
    napi_close_handle_scope(poller->env, scope);
    native_uv_poll_fatal_napi("Failed to create events argument in uv poll callback");
  }

  napi_status = napi_call_function(poller->env, undefined_value, callback, 2, argv, &result);
  if (napi_status == napi_pending_exception) {
    napi_status = napi_get_and_clear_last_exception(poller->env, &exception);
    if (napi_status != napi_ok) {
      napi_close_handle_scope(poller->env, scope);
      native_uv_poll_fatal_napi("Failed to capture exception from uv poll callback");
    }

    napi_status = napi_fatal_exception(poller->env, exception);
    if (napi_status != napi_ok) {
      napi_close_handle_scope(poller->env, scope);
      native_uv_poll_fatal_napi("Failed to report exception from uv poll callback");
    }
  } else if (napi_status != napi_ok) {
    napi_close_handle_scope(poller->env, scope);
    native_uv_poll_fatal_napi("Failed to invoke JavaScript poll callback");
  }

  napi_status = napi_close_handle_scope(poller->env, scope);
  if (napi_status != napi_ok) {
    native_uv_poll_fatal_napi("Failed to close handle scope in uv poll callback");
  }
}

static napi_value native_uv_poll_start(napi_env env, napi_callback_info info) {
  napi_value argv[1];
  native_uv_poll_t *poller = native_uv_poll_get_this(env, info, 1, argv);
  int32_t events;
  int uv_status;
  napi_valuetype value_type;
  napi_value undefined_value;

  if (poller == NULL) {
    return NULL;
  }

  if (poller->closing || poller->closed) {
    napi_throw_error(env, NULL, "Poll handle is closed");
    return NULL;
  }

  NAPI_CALL_RETURN_NULL(env, napi_typeof(env, argv[0], &value_type));
  if (value_type != napi_number) {
    return native_uv_poll_throw_type_error(env, "start(events) requires a numeric event bitmask");
  }

  NAPI_CALL_RETURN_NULL(env, napi_get_value_int32(env, argv[0], &events));
  if (events == 0) {
    return native_uv_poll_throw_type_error(env, "start(events) requires at least one poll event");
  }

  uv_status = uv_poll_start(&poller->uv_poll_handle, events, native_uv_poll_cb);
  if (uv_status < 0) {
    return native_uv_poll_throw_uv_error(env, "uv_poll_start failed", uv_status);
  }

  poller->started = true;

  NAPI_CALL_RETURN_NULL(env, napi_get_undefined(env, &undefined_value));
  return undefined_value;
}

static napi_value native_uv_poll_stop(napi_env env, napi_callback_info info) {
  native_uv_poll_t *poller = native_uv_poll_get_this(env, info, 0, NULL);
  napi_value undefined_value;

  if (poller == NULL) {
    return NULL;
  }

  if (!poller->closing && !poller->closed) {
    uv_poll_stop(&poller->uv_poll_handle);
  }

  poller->started = false;

  NAPI_CALL_RETURN_NULL(env, napi_get_undefined(env, &undefined_value));
  return undefined_value;
}

static napi_value native_uv_poll_close(napi_env env, napi_callback_info info) {
  native_uv_poll_t *poller = native_uv_poll_get_this(env, info, 0, NULL);
  napi_value undefined_value;

  if (poller == NULL) {
    return NULL;
  }

  if (!poller->closing && !poller->closed) {
    if (poller->started) {
      uv_poll_stop(&poller->uv_poll_handle);
      poller->started = false;
    }

    poller->closing = true;
    uv_close((uv_handle_t *) &poller->uv_poll_handle, native_uv_poll_close_cb);
  }

  NAPI_CALL_RETURN_NULL(env, napi_get_undefined(env, &undefined_value));
  return undefined_value;
}

static napi_value native_uv_poll_create_error_result(napi_env env, int error_code) {
  napi_value result;
  napi_value error_value;
  napi_value code_value;
  napi_value undefined_value;

  NAPI_CALL_RETURN_NULL(env, napi_create_object(env, &result));
  NAPI_CALL_RETURN_NULL(env, napi_create_object(env, &error_value));
  NAPI_CALL_RETURN_NULL(env, napi_create_int32(env, error_code, &code_value));
  NAPI_CALL_RETURN_NULL(env, napi_set_named_property(env, error_value, "code", code_value));
  NAPI_CALL_RETURN_NULL(env, napi_set_named_property(env, result, "error", error_value));
  NAPI_CALL_RETURN_NULL(env, napi_get_undefined(env, &undefined_value));
  NAPI_CALL_RETURN_NULL(env, napi_set_named_property(env, result, "handle", undefined_value));

  return result;
}

static napi_value native_uv_poll_create_success_result(
    napi_env env,
    napi_value handle_value) {
  napi_value result;
  napi_value undefined_value;

  NAPI_CALL_RETURN_NULL(env, napi_create_object(env, &result));
  NAPI_CALL_RETURN_NULL(env, napi_get_undefined(env, &undefined_value));
  NAPI_CALL_RETURN_NULL(env, napi_set_named_property(env, result, "error", undefined_value));
  NAPI_CALL_RETURN_NULL(env, napi_set_named_property(env, result, "handle", handle_value));

  return result;
}

static napi_value create_native_uv_poll(napi_env env, napi_callback_info info) {
  napi_value argv[1];
  napi_value args_object;
  napi_value fd_value;
  napi_value callback_value;
  napi_value handle_value;
  native_uv_poll_t *poller;
  napi_property_descriptor properties[3] = {
      {"start", NULL, native_uv_poll_start, NULL, NULL, NULL, napi_default, NULL},
      {"stop", NULL, native_uv_poll_stop, NULL, NULL, NULL, napi_default, NULL},
      {"close", NULL, native_uv_poll_close, NULL, NULL, NULL, napi_default, NULL},
  };
  size_t argc = 1;
  napi_valuetype args_type;
  napi_valuetype callback_type;
  int32_t fd;
  int uv_status;

  NAPI_CALL_RETURN_NULL(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  if (argc < 1) {
    return native_uv_poll_throw_type_error(env, "createNativeUvPoll(args) requires an argument object");
  }

  args_object = argv[0];
  NAPI_CALL_RETURN_NULL(env, napi_typeof(env, args_object, &args_type));
  if (args_type != napi_object) {
    return native_uv_poll_throw_type_error(env, "createNativeUvPoll(args) requires an argument object");
  }

  NAPI_CALL_RETURN_NULL(env, napi_get_named_property(env, args_object, "fd", &fd_value));
  NAPI_CALL_RETURN_NULL(env, napi_get_value_int32(env, fd_value, &fd));
  NAPI_CALL_RETURN_NULL(env, napi_get_named_property(env, args_object, "callback", &callback_value));
  NAPI_CALL_RETURN_NULL(env, napi_typeof(env, callback_value, &callback_type));
  if (callback_type != napi_function) {
    return native_uv_poll_throw_type_error(env, "createNativeUvPoll(args) requires callback to be a function");
  }

  poller = (native_uv_poll_t *) calloc(1, sizeof(*poller));
  if (poller == NULL) {
    napi_throw_error(env, NULL, "Failed to allocate native poll handle");
    return NULL;
  }

  poller->env = env;

  NAPI_CALL_RETURN_NULL(env, napi_create_reference(env, callback_value, 1, &poller->callback_ref));
  NAPI_CALL_RETURN_NULL(env, napi_get_uv_event_loop(env, &poller->loop));

  uv_status = uv_poll_init(poller->loop, &poller->uv_poll_handle, fd);
  if (uv_status < 0) {
    napi_delete_reference(env, poller->callback_ref);
    free(poller);
    return native_uv_poll_create_error_result(env, uv_status);
  }

  poller->uv_poll_handle.data = poller;

  NAPI_CALL_RETURN_NULL(env, napi_create_object(env, &handle_value));
  NAPI_CALL_RETURN_NULL(env, napi_define_properties(env, handle_value, 3, properties));
  NAPI_CALL_RETURN_NULL(env, napi_wrap(env, handle_value, poller, native_uv_poll_finalize, NULL, NULL));

  return native_uv_poll_create_success_result(env, handle_value);
}

static napi_value init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[1] = {
      {"createNativeUvPoll", NULL, create_native_uv_poll, NULL, NULL, NULL, napi_default, NULL},
  };

  NAPI_CALL_RETURN_NULL(env, napi_define_properties(env, exports, 1, properties));
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
