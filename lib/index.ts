import { createPollerInternal } from "./poller.ts";
import { createNativeUvPoll } from "./native.ts";

type TCreatePollerArgs = Omit<Parameters<typeof createPollerInternal>[0], "nativeModule">;

const createPoller = (args: TCreatePollerArgs) => {
  return createPollerInternal({
    ...args,
    nativeModule: {
      createNativeUvPoll
    }
  });
};

export {
  createPoller,
};
