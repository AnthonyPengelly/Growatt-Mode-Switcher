import { run } from "./run.mjs";

export const handler = async (event) => {
  const tariffs = await run();
  return tariffs;
};
