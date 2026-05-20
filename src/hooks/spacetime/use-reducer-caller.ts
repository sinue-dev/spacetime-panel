import { useCallback } from "react";
import { ReducerMetadata } from "@/types/spacetime";
import { SpacetimeConnection } from "@/lib/spacetime-http";

export const useReducerCaller = (
  connection: SpacetimeConnection | null,
  discoveredReducers: ReducerMetadata[],
  onReducerCalled?: () => Promise<void>
) => {
  const callReducer = useCallback(
    async (reducerName: string, args: any) => {
      if (!connection) {
        throw new Error("Not connected to SpacetimeDB");
      }

      const reducerMetadata = discoveredReducers.find(
        (r) => r.name === reducerName
      );
      if (!reducerMetadata) {
        throw new Error(`Reducer metadata not found: ${reducerName}`);
      }

      try {
        const convertedArgs = convertArgsToObject(args);
        const orderedArgs = createOrderedArgs(
          reducerMetadata.fields,
          convertedArgs
        );

        await connection.client.callReducer(
          reducerName,
          orderedArgs,
          connection.token
        );

        if (onReducerCalled) {
          await onReducerCalled();
        }
      } catch (error) {
        console.error(`Failed to call reducer ${reducerName}:`, error);
        throw error;
      }
    },
    [connection, discoveredReducers, onReducerCalled]
  );

  return { callReducer };
};

const toCamelCase = (str: string): string =>
  str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());

const convertArgsToObject = (args: any): Record<string, any> => {
  if (!args || typeof args !== "object") {
    return {};
  }

  const converted: Record<string, any> = {};

  Object.keys(args).forEach((key) => {
    const camelCaseKey = toCamelCase(key);
    converted[camelCaseKey] = args[key];
  });

  return converted;
};

const createOrderedArgs = (
  fields: ReducerMetadata["fields"],
  convertedArgs: Record<string, any>
): any[] => {
  return fields.map((field) => {
    let value = convertedArgs[field.name] ?? convertedArgs[toCamelCase(field.name)];

    if (value !== null && value !== undefined) {
      value = convertValueByType(value, field.type);
    }

    if (
      field.isOptional &&
      (value === null || value === undefined || value === "")
    ) {
      return null;
    }

    return value;
  });
};

const convertValueByType = (value: any, type: string): any => {
  if (type === "string" || type.includes("String")) {
    return String(value);
  }

  if (["u64", "u128", "u256", "i64", "i128", "i256"].includes(type)) {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return String(value);
  }

  if (type === "boolean" || type === "Bool") {
    return Boolean(value);
  }

  if (type.startsWith("u") || type.startsWith("i") || type.startsWith("f")) {
    return Number(value);
  }

  return value;
};
