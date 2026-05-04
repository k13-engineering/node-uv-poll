#include <node_api.h>
#include <uv.h>

struct poll_context {
    uv_poll_t poll_handle;
    napi_env env;
    napi_ref callback_ref;
    napi_ref buffer_ref;
};

static void poll_cb(uv_poll_t* handle, int status, int events) {
    struct poll_context* ctx = (struct poll_context*)handle->data;
    napi_env env = ctx->env;
    napi_handle_scope scope;
    napi_value callback;
    napi_value global;
    napi_value argv[2];
    napi_value result;

    if (napi_open_handle_scope(env, &scope) != napi_ok) {
        return;
    }

    napi_get_reference_value(env, ctx->callback_ref, &callback);
    napi_get_global(env, &global);
    napi_create_int32(env, status, &argv[0]);
    napi_create_int32(env, events, &argv[1]);

    napi_make_callback(env, NULL, global, callback, 2, argv, &result);

    napi_close_handle_scope(env, scope);
}

static void close_cb(uv_handle_t* handle) {
    struct poll_context* ctx = (struct poll_context*)handle->data;
    napi_env env = ctx->env;

    napi_delete_reference(env, ctx->callback_ref);
    napi_delete_reference(env, ctx->buffer_ref);
}

static napi_value handle_start_fn(napi_env env, napi_callback_info info) {
    napi_value argv[1];
    size_t argc = 1;
    napi_value this_arg;
    void* data;
    struct poll_context* ctx;
    int32_t events;
    napi_value undefined;

    napi_get_undefined(env, &undefined);

    if (napi_get_cb_info(env, info, &argc, argv, &this_arg, &data) != napi_ok) {
        return undefined;
    }

    ctx = (struct poll_context*)data;

    if (napi_get_value_int32(env, argv[0], &events) != napi_ok) {
        return undefined;
    }

    uv_poll_start(&ctx->poll_handle, events, poll_cb);

    return undefined;
}

static napi_value handle_stop_fn(napi_env env, napi_callback_info info) {
    size_t argc = 0;
    napi_value this_arg;
    void* data;
    struct poll_context* ctx;
    napi_value undefined;

    napi_get_undefined(env, &undefined);

    if (napi_get_cb_info(env, info, &argc, NULL, &this_arg, &data) != napi_ok) {
        return undefined;
    }

    ctx = (struct poll_context*)data;

    uv_poll_stop(&ctx->poll_handle);

    return undefined;
}

static napi_value handle_close_fn(napi_env env, napi_callback_info info) {
    size_t argc = 0;
    napi_value this_arg;
    void* data;
    struct poll_context* ctx;
    napi_value undefined;

    napi_get_undefined(env, &undefined);

    if (napi_get_cb_info(env, info, &argc, NULL, &this_arg, &data) != napi_ok) {
        return undefined;
    }

    ctx = (struct poll_context*)data;

    uv_close((uv_handle_t*)&ctx->poll_handle, close_cb);

    return undefined;
}

static napi_value create_native_uv_poll_fn(napi_env env, napi_callback_info info) {
    napi_value argv[1];
    size_t argc = 1;
    napi_value this_arg;
    napi_value undefined;
    napi_value result;
    napi_value args_obj;
    napi_value fd_value;
    napi_value callback_value;
    int32_t fd;
    uv_loop_t* loop;
    struct poll_context* ctx;
    napi_value buffer;
    void* buffer_data;
    int uv_err;

    napi_get_undefined(env, &undefined);

    if (napi_get_cb_info(env, info, &argc, argv, &this_arg, NULL) != napi_ok) {
        return undefined;
    }

    args_obj = argv[0];

    if (napi_get_named_property(env, args_obj, "fd", &fd_value) != napi_ok) {
        return undefined;
    }
    if (napi_get_value_int32(env, fd_value, &fd) != napi_ok) {
        return undefined;
    }

    if (napi_get_named_property(env, args_obj, "callback", &callback_value) != napi_ok) {
        return undefined;
    }

    if (napi_get_uv_event_loop(env, &loop) != napi_ok) {
        return undefined;
    }

    if (napi_create_arraybuffer(env, sizeof(struct poll_context), &buffer_data, &buffer) != napi_ok) {
        return undefined;
    }

    ctx = (struct poll_context*)buffer_data;
    ctx->env = env;

    if (napi_create_reference(env, buffer, 1, &ctx->buffer_ref) != napi_ok) {
        return undefined;
    }

    if (napi_create_reference(env, callback_value, 1, &ctx->callback_ref) != napi_ok) {
        napi_delete_reference(env, ctx->buffer_ref);
        return undefined;
    }

    uv_err = uv_poll_init(loop, &ctx->poll_handle, fd);
    ctx->poll_handle.data = ctx;

    if (napi_create_object(env, &result) != napi_ok) {
        return undefined;
    }

    if (uv_err != 0) {
        napi_value error_obj;
        napi_value code_value;

        napi_delete_reference(env, ctx->callback_ref);
        napi_delete_reference(env, ctx->buffer_ref);

        if (napi_create_object(env, &error_obj) != napi_ok) {
            return undefined;
        }
        if (napi_create_int32(env, uv_err, &code_value) != napi_ok) {
            return undefined;
        }
        if (napi_set_named_property(env, error_obj, "code", code_value) != napi_ok) {
            return undefined;
        }
        if (napi_set_named_property(env, result, "error", error_obj) != napi_ok) {
            return undefined;
        }
        if (napi_set_named_property(env, result, "handle", undefined) != napi_ok) {
            return undefined;
        }

        return result;
    }

    {
        napi_value handle_obj;
        napi_value start_fn;
        napi_value stop_fn;
        napi_value close_fn;

        if (napi_create_object(env, &handle_obj) != napi_ok) {
            return undefined;
        }

        if (napi_create_function(env, NULL, 0, handle_start_fn, ctx, &start_fn) != napi_ok) {
            return undefined;
        }
        if (napi_create_function(env, NULL, 0, handle_stop_fn, ctx, &stop_fn) != napi_ok) {
            return undefined;
        }
        if (napi_create_function(env, NULL, 0, handle_close_fn, ctx, &close_fn) != napi_ok) {
            return undefined;
        }

        if (napi_set_named_property(env, handle_obj, "start", start_fn) != napi_ok) {
            return undefined;
        }
        if (napi_set_named_property(env, handle_obj, "stop", stop_fn) != napi_ok) {
            return undefined;
        }
        if (napi_set_named_property(env, handle_obj, "close", close_fn) != napi_ok) {
            return undefined;
        }

        if (napi_set_named_property(env, result, "error", undefined) != napi_ok) {
            return undefined;
        }
        if (napi_set_named_property(env, result, "handle", handle_obj) != napi_ok) {
            return undefined;
        }
    }

    return result;
}

static napi_value init(napi_env env, napi_value exports) {
    napi_value module;
    napi_value fn;

    if (napi_create_object(env, &module) != napi_ok) {
        return NULL;
    }

    if (napi_create_function(env, NULL, 0, create_native_uv_poll_fn, NULL, &fn) != napi_ok) {
        return NULL;
    }

    if (napi_set_named_property(env, module, "createNativeUvPoll", fn) != napi_ok) {
        return NULL;
    }

    return module;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
