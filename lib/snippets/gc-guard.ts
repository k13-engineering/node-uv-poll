type TInstance = {
  release: () => void;
};

let finalizationRegistries: FinalizationRegistry<unknown>[] = [];

const createGarbageCollectionGuard = <T>({
  createError,
}: {
  createError: (args: { info: T }) => Error,
}) => {

  // eslint-disable-next-line k13-engineering/no-new
  const instanceFinalizationRegistry = new FinalizationRegistry((info: T) => {
    // this callback is called when a instance is garbage collected without release being called
    throw createError({ info });
  });

  finalizationRegistries = [
    ...finalizationRegistries,
    instanceFinalizationRegistry
  ];

  const protect = ({
    release: providedRelease,
    info
  }: { release: () => void; info: T }): TInstance => {
    const release = () => {
      providedRelease();
      instanceFinalizationRegistry.unregister(release);

      finalizationRegistries = finalizationRegistries.filter((registry) => {
        return registry !== instanceFinalizationRegistry;
      });
    };

    instanceFinalizationRegistry.register(release, info, release);

    return {
      release
    };
  };

  return {
    protect
  };
};

const createDefaultGarbageCollectedWithoutReleaseError = ({
  name,
  info,
  releaseFunctionName,
  resourcesName,
  allocationStackTrace
}: {
  name: string,
  info: string,
  releaseFunctionName: string,
  resourcesName: string,
  allocationStackTrace: string
}) => {

  let message = `${info} was garbage collected without calling release().`;
  message += ` This would cause a memory leak -`;
  message += ` therefore this raises an uncaught exception.`;
  message += ` Please make sure to call ${releaseFunctionName}() on all ${resourcesName} when you are done with them.`;
  message += ` Underlying resources should have still be cleaned up in case you are catching uncaught exceptions -`;
  message += ` however, do not rely on this behavior (specifically for production code).`;
  message += ` Allocation stack trace:`;
  allocationStackTrace.split("\n").forEach((line) => {
    message += `\n  ${line}`;
  });

  const error = Error(message);
  // eslint-disable-next-line immutable/no-mutation
  error.name = name;

  return error;
};

export {
  createGarbageCollectionGuard,
  createDefaultGarbageCollectedWithoutReleaseError
};
