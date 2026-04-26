
const createStackTrace = ({ up }: { up: number }) => {
  const error = Error();
  /* c8 ignore next 3 */
  if (error.stack === undefined) {
    throw Error("failed to create stack trace");
  }

  const lines = error.stack.split("\n");

  const relevantLines = lines.slice(2 + up);

  const trimmedRelevantLines = relevantLines.map((line) => {
    return line.trim();
  });

  const stackTrace = trimmedRelevantLines.join("\n");

  return stackTrace;
};

export {
  createStackTrace
};
