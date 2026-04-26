import { createDefaultNativeAddonLoader } from "./snippets/native-loader.ts";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";

const ourScriptPath = fileURLToPath(import.meta.url);
const ourScriptFolder = nodePath.dirname(ourScriptPath);
const isDistBuild = ourScriptFolder.endsWith("dist/lib");

const nativeAddonLoader = createDefaultNativeAddonLoader({
  importMeta: import.meta,
  buildFolderPath: isDistBuild ? "../../build" : "../build",
});

type TNativePollerInstance = {
  start: (events: number) => void;
  stop: () => void;
  close: () => void;
};

type TNativeModule = {
  createNativeUvPoll: (args: {
    fd: number,
    callback: (status: number, events: number) => void
  }) => {
    error: {
      code: number
    },
    handle: undefined
  } | {
    error: undefined,
    handle: TNativePollerInstance
  }
};

const { createNativeUvPoll } = nativeAddonLoader.load() as TNativeModule;

export type {
  TNativePollerInstance,
  TNativeModule,
};

export {
  createNativeUvPoll
};
