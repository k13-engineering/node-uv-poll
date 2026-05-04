import assert from "node:assert/strict";
import nodeFs from "node:fs";
import { createPoller } from "../dist/lib/index.js";
import { UV_EBADF, UV_READABLE } from "../dist/lib/constants.js";
import { syscall, syscallNumbers } from "syscall-napi";
import { createPollerInternal } from "../dist/lib/poller.js";
import { type TNativeModule } from "../dist/lib/native.js";

const AF_UNIX = 1n;
const SOCK_STREAM = 1n;

const createSocketPair = (): [number, number] => {
  const buf = new Uint8Array(8);
  const result = syscall({
    syscallNumber: syscallNumbers.socketpair,
    args: [AF_UNIX, SOCK_STREAM, 0n, buf],
  });

  if (result.errno !== undefined) {
    throw new Error(`socketpair failed with errno ${result.errno}`);
  }

  const view = new DataView(buf.buffer);
  return [view.getInt32(0, true), view.getInt32(4, true)];
};

const closeFd = (fd: number) => {
  syscall({ syscallNumber: syscallNumbers.close, args: [BigInt(fd)] });
};

const writeFd = ({ fd, data }: { fd: number; data: Uint8Array }) => {
  const result = syscall({
    syscallNumber: syscallNumbers.write,
    args: [BigInt(fd), data, BigInt(data.length)],
  });

  if (result.errno !== undefined) {
    throw new Error(`write failed with errno ${result.errno}`);
  }
};

// eslint-disable-next-line max-statements
describe("createPoller", () => {
  let fdsToClose: number[] = [];
  let pollersToClose: ReturnType<typeof createPoller>[] = [];

  afterEach(() => {
    for (const poller of pollersToClose) {
      poller.close();
    }
    pollersToClose = [];

    for (const fd of fdsToClose) {
      closeFd(fd);
    }
    fdsToClose = [];
  });

  const trackFd = (fd: number) => {
    fdsToClose = [...fdsToClose, fd];
    return fd;
  };

  const trackPoller = (poller: ReturnType<typeof createPoller>) => {
    pollersToClose = [...pollersToClose, poller];
    return poller;
  };

  const untrackFd = (fd: number) => {
    fdsToClose = fdsToClose.filter((f) => {
      return f !== fd;
    });
  };

  const untrackPoller = (poller: ReturnType<typeof createPoller>) => {
    pollersToClose = pollersToClose.filter((p) => {
      return p !== poller;
    });
  };

  it("should create a poller for a valid file descriptor", () => {
    const [fd1, fd2] = createSocketPair();
    trackFd(fd1);
    trackFd(fd2);

    const poller = createPoller({ fd: fd1 });
    trackPoller(poller);
  });

  it("should throw for an invalid file descriptor", () => {
    assert.throws(
      () => {
        return createPoller({ fd: -1 });
      },
      /invalid file descriptor/,
    );
  });

  it("should throw for a non-pollable file descriptor (regular file)", () => {
    const fd = nodeFs.openSync("/etc/hostname", "r");
    trackFd(fd);

    assert.throws(
      () => {
        return createPoller({ fd });
      },
      /probably not a pollable file descriptor/,
    );
  });

  it("should call readable callback when data is written to the other end", (done) => {
    const [fd1, fd2] = createSocketPair();
    trackFd(fd1);
    trackFd(fd2);

    const poller = createPoller({ fd: fd1 });
    trackPoller(poller);

    poller.armOnce({
      error: () => {
        throw Error(`error callback should not have been called`);
      },

      readable: () => {
        untrackPoller(poller);
        poller.close();
        done();
      },
    });
    writeFd({ fd: fd2, data: new TextEncoder().encode("hello") });
  });

  it("should call writable callback on a connected socket", (done) => {
    const [fd1, fd2] = createSocketPair();
    trackFd(fd1);
    trackFd(fd2);

    const poller = createPoller({ fd: fd1 });
    trackPoller(poller);

    poller.armOnce({
      error: () => {
        throw Error(`error callback should not have been called`);
      },

      writable: () => {
        untrackPoller(poller);
        poller.close();
        done();
      },
    });
  });

  it("should only fire once after arming (one-shot)", (done) => {
    const [fd1, fd2] = createSocketPair();
    trackFd(fd1);
    trackFd(fd2);

    let fireCount = 0;

    const poller = createPoller({ fd: fd1 });
    trackPoller(poller);

    poller.armOnce({
      error: () => {
        throw Error(`error callback should not have been called`);
      },

      readable: () => {
        fireCount += 1;
      },
    });
    writeFd({ fd: fd2, data: new TextEncoder().encode("first") });
    writeFd({ fd: fd2, data: new TextEncoder().encode("second") });

    setTimeout(() => {
      assert.equal(fireCount, 1);
      done();
    }, 50);
  });

  it("should fire again after re-arming", (done) => {
    const [fd1, fd2] = createSocketPair();
    trackFd(fd1);
    trackFd(fd2);

    let fireCount = 0;

    const poller = createPoller({ fd: fd1 });
    trackPoller(poller);

    const armReadable = () => {
      poller.armOnce({
        error: () => {
          throw Error(`error callback should not have been called`);
        },

        readable: () => {
          fireCount += 1;

          if (fireCount === 1) {
            armReadable();
            writeFd({ fd: fd2, data: new TextEncoder().encode("second") });
          }

          if (fireCount === 2) {
            untrackPoller(poller);
            poller.close();
            done();
          }
        },
      });
    };

    armReadable();
    writeFd({ fd: fd2, data: new TextEncoder().encode("first") });
  });

  it("should re-arm with different events while already armed", (done) => {
    const [fd1, fd2] = createSocketPair();
    trackFd(fd1);
    trackFd(fd2);

    const poller = createPoller({ fd: fd1 });
    trackPoller(poller);

    poller.armOnce({
      error: () => {
        throw Error(`error callback should not have been called`);
      },

      readable: () => {
        assert.fail("readable should not have been called");
      },
    });
    poller.armOnce({
      error: () => {
        throw Error(`error callback should not have been called`);
      },

      writable: () => {
        untrackPoller(poller);
        poller.close();
        done();
      },
    });
  });

  it("should throw when arming with no events", () => {
    const [fd1, fd2] = createSocketPair();
    trackFd(fd1);
    trackFd(fd2);

    const poller = createPoller({ fd: fd1 });
    trackPoller(poller);

    assert.throws(
      () => {
        return poller.armOnce({
          error: () => {
            throw Error(`error callback should not have been called`);
          },
        });
      },
      /at least one event must be set/,
    );
  });

  it("should not fire after disarming", (done) => {
    const [fd1, fd2] = createSocketPair();
    trackFd(fd1);
    trackFd(fd2);

    let fired = false;

    const poller = createPoller({ fd: fd1 });
    trackPoller(poller);

    poller.armOnce({
      error: () => {
        throw Error(`error callback should not have been called`);
      },

      readable: () => {
        fired = true;
      },
    });
    poller.disarm();

    writeFd({ fd: fd2, data: new TextEncoder().encode("hello") });

    setTimeout(() => {
      assert.equal(fired, false);
      done();
    }, 50);
  });

  it("should have no effect when disarming a poller that is not armed", () => {
    const [fd1, fd2] = createSocketPair();
    trackFd(fd1);
    trackFd(fd2);

    const poller = createPoller({ fd: fd1 });
    trackPoller(poller);

    poller.disarm();
  });

  it("should throw when closing an already closed poller", () => {
    const [fd1, fd2] = createSocketPair();
    trackFd(fd1);
    trackFd(fd2);

    const poller = createPoller({ fd: fd1 });

    poller.close();

    assert.throws(
      () => {
        return poller.close();
      },
      /already closed/,
    );
  });

  it("should fire when the peer socket is closed", (done) => {
    const [fd1, fd2] = createSocketPair();
    trackFd(fd1);
    trackFd(fd2);

    const poller = createPoller({ fd: fd1 });
    trackPoller(poller);

    poller.armOnce({
      error: () => {
        throw Error(`error callback should not have been called`);
      },

      readable: () => {
        untrackPoller(poller);
        poller.close();
        done();
      },
      disconnect: () => {
        untrackPoller(poller);
        poller.close();
        done();
      },
    });

    untrackFd(fd2);
    closeFd(fd2);
  });

  it("should arm for multiple events simultaneously", (done) => {
    const [fd1, fd2] = createSocketPair();
    trackFd(fd1);
    trackFd(fd2);

    let callbackCalled = false;

    const poller = createPoller({ fd: fd1 });
    trackPoller(poller);

    poller.armOnce({
      error: () => {
        throw Error(`error callback should not have been called`);
      },

      readable: () => {
        if (!callbackCalled) {
          callbackCalled = true;
          untrackPoller(poller);
          poller.close();
          done();
        }
      },
      writable: () => {
        if (!callbackCalled) {
          callbackCalled = true;
          untrackPoller(poller);
          poller.close();
          done();
        }
      },
    });
  });

  it("should throw when arm() is called after close()", () => {
    const [fd1, fd2] = createSocketPair();
    trackFd(fd1);
    trackFd(fd2);

    const poller = createPoller({ fd: fd1 });
    poller.close();

    assert.throws(
      () => {
        return poller.armOnce({
          error: () => { },
          readable: () => { },
        });
      },
      /already closed/,
    );
  });

  it("should throw (or be a safe no-op) when disarm() is called after close()", () => {
    const [fd1, fd2] = createSocketPair();
    trackFd(fd1);
    trackFd(fd2);

    const poller = createPoller({ fd: fd1 });
    poller.close();

    assert.throws(
      () => {
        return poller.disarm();
      },
      /already closed/,
    );
  });

  it("should not invoke stale callbacks for other events from the same fire after re-arming inside a callback", (done) => {
    const [fd1, fd2] = createSocketPair();
    trackFd(fd1);
    trackFd(fd2);

    // Make fd1 both readable (peer wrote data) and writable (fresh socket).
    writeFd({ fd: fd2, data: new TextEncoder().encode("data") });

    let staleWritableCalls = 0;
    let readableCalls = 0;

    const poller = createPoller({ fd: fd1 });
    trackPoller(poller);

    poller.armOnce({
      error: () => {
        throw Error(`error callback should not have been called`);
      },

      readable: () => {
        readableCalls += 1;
        // Re-arm with a no-op set; this should logically cancel the
        // remaining stale dispatch for THIS fire.
        poller.disarm();
      },

      writable: () => {
        // Must NOT be called once readable's body has already disarmed.
        staleWritableCalls += 1;
      },
    });

    // Give the microtask + any spurious follow-ups time to settle, then check.
    setTimeout(() => {
      try {
        assert.ok(readableCalls >= 1,
          "readable should have fired at least once");
        assert.equal(staleWritableCalls, 0,
          "stale writable from the previous arm() must not fire after "
            + "disarm() was called inside the readable callback of the "
            + "same multi-event dispatch");
        untrackPoller(poller);
        poller.close();
        done();
      } catch (err) {
        done(err);
      }
    }, 50);
  });

  it("should report errorCode using the same sign convention as UV_E* constants", async () => {
    // Sanity: constants are negative, matching libuv's convention.
    assert.ok(UV_EBADF < 0, `UV_EBADF must be negative, got ${UV_EBADF}`);

    const url = new URL("../lib/index.ts", import.meta.url);
    const source = await nodeFs.promises.readFile(url, "utf8");

    // The error dispatch must NOT negate `status` (which is already negative
    // on error from libuv); negating it produces the wrong sign for the user.
    assert.doesNotMatch(
      source,
      /errorCode:\s*-status\b/,
      "lib/index.ts negates `status` when building errorCode; this flips the "
        + "sign so that errorCode no longer matches UV_EBADF / UV_EPERM. Pass "
        + "`status` directly (it is already negative on error).",
    );
  });

  it("should not fire when disarm was called after microtask scheduling but before the actual fire", (done) => {
    const [fd1, fd2] = createSocketPair();
    trackFd(fd1);
    trackFd(fd2);

    let nativeCallback: ((status: number, events: number) => void) | undefined;

    const mockNativeModule: TNativeModule = {
      createNativeUvPoll: ({ callback }) => {
        nativeCallback = callback;
        return {
          error: undefined,
          handle: {
            start: () => {},
            stop: () => {},
            close: () => {},
          },
        };
      },
    };

    let readableFired = false;

    const poller = createPollerInternal({ nativeModule: mockNativeModule, fd: fd1 });
    trackPoller(poller);

    poller.armOnce({
      error: () => {
        throw Error("error callback should not have been called");
      },
      readable: () => {
        readableFired = true;
      },
    });

    // Simulate the native event firing synchronously — this schedules
    // the dispatch as a microtask inside createPollerInternal.
    nativeCallback!(0, UV_READABLE);

    // Disarm *after* the microtask was scheduled but *before* it runs.
    poller.disarm();

    setTimeout(() => {
      try {
        assert.equal(readableFired, false,
          "readable callback must not fire when disarm() was called "
            + "between the native callback and the microtask dispatch");
        untrackPoller(poller);
        poller.close();
        done();
      } catch (err) {
        done(err);
      }
    }, 50);
  });
});
