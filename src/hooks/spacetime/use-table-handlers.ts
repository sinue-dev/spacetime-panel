import { useCallback } from "react";
import { useAppDispatch } from "@/store/hooks";
import { setTableData } from "@/store/spacetime-slice";
import { processTableDataForRedux } from "@/utils/serialization";
import { TableMetadata } from "@/types/spacetime";
import { SpacetimeHttpClient, SqlResult } from "@/lib/spacetime-http";

const sqlResultToObjects = (result?: SqlResult): any[] => {
  if (!result) return [];

  const columns = (result.schema?.elements || []).map((element) => element.name);

  if (!columns.length) {
    return [];
  }

  return (result.rows || []).map((row) => {
    const rowObject: Record<string, unknown> = {};
    columns.forEach((columnName, index) => {
      rowObject[columnName] = row[index];
    });
    return rowObject;
  });
};

export const useTableHandlers = (discoveredTables: TableMetadata[]) => {
  const dispatch = useAppDispatch();

  const loadTableData = useCallback(
    async (
      client: SpacetimeHttpClient,
      tableName: string,
      token?: string | null
    ): Promise<void> => {
      try {
        const results = await client.querySql(`SELECT * FROM ${tableName}`, token);
        const rows = sqlResultToObjects(results[0]);
        const serializedData = processTableDataForRedux(rows);
        dispatch(setTableData({ tableName, data: serializedData }));
      } catch (error) {
        console.error(`Failed to load table ${tableName}:`, error);
      }
    },
    [dispatch]
  );

  const loadAllTables = useCallback(
    async (client: SpacetimeHttpClient, token?: string | null): Promise<void> => {
      await Promise.all(
        discoveredTables.map((table) => loadTableData(client, table.name, token))
      );
    },
    [discoveredTables, loadTableData]
  );

  return { loadTableData, loadAllTables };
};
