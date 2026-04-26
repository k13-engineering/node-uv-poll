import {
  UV_DISCONNECT,
  UV_EBADF,
  UV_EPERM,
  UV_PRIORITIZED,
  UV_READABLE,
  UV_WRITABLE
} from "./constants.ts";
import { type TNativeModule } from "./native.ts";
import { createDefaultGarbageCollectedWithoutReleaseError, createGarbageCollectionGuard } from "./snippets/gc-guard.ts";

type TPollEvents = {
  error: (args: { errorCode: number }) => void;
  readable?: () => void;
  writable?: () => void;
  disconnect?: () => void;
  prioritized?: () => void;
};

const raiseUnhandledError = ({ error }: { error: Error }) => {
  Promise.resolve().then(() => {
    throw error;
  });
};

// eslint-disable-next-line complexity
const eventsToBitmask = ({ events }: { events: TPollEvents }) => {
  let bitmask = 0;

  if (events.readable) {
    bitmask |= UV_READABLE;
  }

  if (events.writable) {
    bitmask |= UV_WRITABLE;
  }

  if (events.disconnect) {
    bitmask |= UV_DISCONNECT;
  }

  if (events.prioritized) {
    bitmask |= UV_PRIORITIZED;
  }

  return bitmask;
};

const scheduleMicrotask = (fn: () => void) => {
  Promise.resolve().then(fn);
};

let pollerCounter = 0;

/**
 * Creates a poller for the given file descriptor.
 * Callbacks are provided via arm() and will only be called once after arming.
 */
// eslint-disable-next-line max-statements
const createPollerInternal = ({
  nativeModule,
  fd,
}: {
  nativeModule: TNativeModule,
  fd: number;
}) => {

  const pollerId = pollerCounter;
  pollerCounter += 1;

  let armedEvents: TPollEvents | undefined;

  let closed = false;

  const { error: createHandleError, handle } = nativeModule.createNativeUvPoll({
    fd,
    // eslint-disable-next-line k13-engineering/prefer-single-object-parameters
    callback: (status, eventsBitmask) => {

      if (handle === undefined) {
        raiseUnhandledError({
          error: Error(`BUG: callback called with undefined handle`)
        });
        return;
      }

      if (armedEvents === undefined) {
        raiseUnhandledError({
          error: Error(`BUG: callback called while poller is not armed`)
        });
        return;
      }

      if (closed) {
        raiseUnhandledError({
          error: Error(`BUG: callback called after poller is closed`)
        });
        return;
      }

      handle.stop();

      // armed events is another instance for every call of arm()
      const ourEvents = armedEvents;

      // TODO: fix glitch

      // eslint-disable-next-line max-statements,complexity
      scheduleMicrotask(() => {

        if (ourEvents === undefined) {
          throw Error(`BUG: callback called without armed events`);
        }

        if (ourEvents !== armedEvents) {
          // we are outdated
          return;
        }

        armedEvents = undefined;

        // schedule microtask, so exception will raise unhandled exception
        if (status > 0) {
          throw Error(
            `unexpected positive status code ${status} received from native addon, expected 0 for success or negative value for error`
          );
        }

        if (status < 0) {
          ourEvents.error({ errorCode: status });
          return;
        }

        if ((eventsBitmask & UV_PRIORITIZED) !== 0 && ourEvents.prioritized) {
          ourEvents.prioritized();
          return;
        }

        if ((eventsBitmask & UV_READABLE) !== 0 && ourEvents.readable) {
          ourEvents.readable();
          return;
        }

        if ((eventsBitmask & UV_WRITABLE) !== 0 && ourEvents.writable) {
          ourEvents.writable();
          return;
        }

        if ((eventsBitmask & UV_DISCONNECT) !== 0 && ourEvents.disconnect) {
          ourEvents.disconnect();
          return;
        }
      });
    }
  });

  if (createHandleError !== undefined) {

    if (createHandleError.code === UV_EPERM) {
      throw Error(`probably not a pollable file descriptor ${fd} provided`, { cause: createHandleError });
    }

    if (createHandleError.code === UV_EBADF) {
      throw Error(`invalid file descriptor ${fd} provided to createPoller`, { cause: createHandleError });
    }

    throw Error(`failed to create native poll handle`, { cause: createHandleError });
  }

  /**
   * Arms the poller for the specified events. When any of the specified events occur, the corresponding callback will be called.
   * The poller will be automatically disarmed after firing, so it needs to be re-armed to fire again.
   * If the poller is already armed, calling arm again will re-arm it with the new events.
   */
  const armOnce = (events: TPollEvents) => {
    if (closed) {
      throw Error("already closed");
    }

    const eventBitmask = eventsToBitmask({ events });

    if (eventBitmask === 0) {
      throw Error(`at least one event must be set to arm the poller`);
    }

    armedEvents = { ...events };
    handle.start(eventBitmask);
  };

  /**
   * Disarms the poller. After calling disarm, the callbacks will not be called until the poller is armed again.
   * If the poller is not armed, calling disarm will have no effect.
   */
  const disarm = () => {
    if (closed) {
      throw Error("already closed");
    }

    armedEvents = undefined;
    handle.stop();
  };

  const gcGuard = createGarbageCollectionGuard<{
    pollerId: number,
    fd: number,
  }>({
    createError: ({ info }) => {
      return createDefaultGarbageCollectedWithoutReleaseError({
        info: `pollerId=${info.pollerId}@fd=${info.fd}`,
        name: "Poller",
        allocationStackTrace: "",
        releaseFunctionName: "close()",
        resourcesName: "poll handle",
      });
    }
  });

  const internalClose = () => {
    if (closed) {
      throw Error("already closed");
    }

    closed = true;
    handle.close();
  };

  const { release: close } = gcGuard.protect({

    info: {
      pollerId,
      fd,
    },

    release: () => {
      return internalClose();
    }
  });

  return {
    armOnce,
    disarm,
    close
  };
};

type TPollerInstance = ReturnType<typeof createPollerInternal>;

export {
  createPollerInternal,
};

export type {
  TPollEvents,
  TPollerInstance,
};
