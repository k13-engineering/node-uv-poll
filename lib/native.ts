import { createDefaultAddonLoader } from "@k13engineering/addon-loader";
import { uvPollAddonArm64 } from "./generated/uv-poll-arm64.ts";
import { uvPollAddonX64 } from "./generated/uv-poll-x64.ts";
import nodeProcess from "node:process";

const addonBinariesByArch: Partial<{ [key in NodeJS.Architecture]: Uint8Array }> = {
  x64: uvPollAddonX64,
  arm64: uvPollAddonArm64,
};

const addonLoader = createDefaultAddonLoader();

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

let loadedAddon: TNativeModule | undefined = undefined;

// eslint-disable-next-line complexity
const createNativeUvPoll = (arg: Parameters<TNativeModule["createNativeUvPoll"]>[0]) => {
  if (loadedAddon !== undefined) {
    return loadedAddon.createNativeUvPoll(arg);
  }

  if (nodeProcess.platform !== "linux") {
    throw Error("only supported on linux");
  }

  const addonBinary = addonBinariesByArch[nodeProcess.arch];
  if (addonBinary === undefined) {
    throw Error(`unsupported architecture: ${nodeProcess.arch}`);
  }

  const { error, addon } = addonLoader.loadAddonFromMemory({ addonAsBuffer: addonBinary });
  if (error !== undefined) {
    throw Error(`failed to load native addon from memory: ${error.message}`);
  }

  loadedAddon = addon as TNativeModule;
  return loadedAddon.createNativeUvPoll(arg);
};

export type {
  TNativePollerInstance,
  TNativeModule,
};

export {
  createNativeUvPoll
};
