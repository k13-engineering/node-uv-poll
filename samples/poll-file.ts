import nodeFs from "node:fs";
import { fileURLToPath } from "node:url";
import { createPoller } from "../lib/index.ts";

const fd = nodeFs.openSync(fileURLToPath(import.meta.url), "r");
console.log({ fd });


const poller = createPoller({ fd });

poller.armOnce({
  error: () => {
    throw Error(`error callback should not have been called`);
  },

  readable: () => {
    // needs re-arm
    console.log(`file is ready for reading`);
  },
});

// poller.disarm();
