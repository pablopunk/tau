import { createContext, useContext } from "react";

const LatestTodoCallContext = createContext<string | undefined>(undefined);

export const LatestTodoCallProvider = LatestTodoCallContext.Provider;

export const useIsSupersededTodoCall = (callId: string) => {
  const latest = useContext(LatestTodoCallContext);
  return latest !== undefined && latest !== callId;
};
