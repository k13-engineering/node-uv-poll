import { createPollerInternal, type TPollerInstance } from "./poller.ts";
import { createNativeUvPoll } from "./native.ts";

const createPoller = ({ fd }: { fd: number }): TPollerInstance => {
  return createPollerInternal({
    nativeModule: {
      createNativeUvPoll
    },
    fd
  });
};

export {
  createPoller,
};
