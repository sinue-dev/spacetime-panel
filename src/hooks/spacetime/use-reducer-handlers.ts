import { useCallback } from "react";
import type { EventCallbacks } from "./use-event-callbacks";
import { ReducerMetadata } from "@/types/spacetime";

export const useReducerHandlers = (
  discoveredReducers: ReducerMetadata[],
  getCallback: (name: string) => EventCallbacks[string]
) => {
  const setupReducerHandlers = useCallback(() => {
    discoveredReducers.forEach((reducer) => {
      const eventHandlerName = `on${capitalize(toCamelCase(reducer.name))}`;
      getCallback(eventHandlerName);
    });
  }, [discoveredReducers, getCallback]);

  return { setupReducerHandlers };
};

const toCamelCase = (str: string): string =>
  str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());

const capitalize = (str: string): string =>
  str.charAt(0).toUpperCase() + str.slice(1);
