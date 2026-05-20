import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  setConnectionStatus,
  setConnection,
  setIdentity,
  setError,
  clearAllTables,
  clearError as clearErrorAction,
  initializeTable,
  insertTableRow,
  updateTableRow,
  deleteTableRow,
} from "@/store/spacetime-slice";
import { spacetimeIntrospector } from "@/utils/introspection/spacetime-introspector";
import { spacetimeConfig } from "@/config/spacetime";
import { useEventCallbacks } from "./spacetime/use-event-callbacks";
import { useConnectionState } from "./spacetime/use-connection-state";
import { useTableHandlers } from "./spacetime/use-table-handlers";
import { useReducerHandlers } from "./spacetime/use-reducer-handlers";
import { useReducerCaller } from "./spacetime/use-reducer-caller";
import {
  SpacetimeConnection,
  SpacetimeHttpClient,
} from "@/lib/spacetime-http";

export const useSpacetimeDB = () => {
  const dispatch = useAppDispatch();
  const { connectionStatus, connection, identity, error } = useAppSelector(
    (state) => state.spacetime
  );

  const pollingIntervalRef = useRef<number | null>(null);

  const spacetimeState = useAppSelector((state) => state.spacetime);

  const { registerEventCallbacks, unregisterEventCallbacks, getCallback } =
    useEventCallbacks();
  const connectionState = useConnectionState();

  const discoveredTables = spacetimeIntrospector.discoverTables();
  const discoveredReducers = spacetimeIntrospector.discoverReducers();

  const isConnected = connectionStatus === "connected";
  const isConnecting = connectionStatus === "connecting";

  const { loadAllTables } = useTableHandlers(discoveredTables);
  const { setupReducerHandlers } = useReducerHandlers(
    discoveredReducers,
    getCallback
  );

  const refreshAllTables = useCallback(
    async (activeConnection?: SpacetimeConnection | null) => {
      const connectionToUse =
        activeConnection || (connection as SpacetimeConnection | null);
      if (!connectionToUse) return;

      await loadAllTables(connectionToUse.client, connectionToUse.token);
    },
    [connection, loadAllTables]
  );

  const { callReducer } = useReducerCaller(
    connection as SpacetimeConnection | null,
    discoveredReducers,
    () => refreshAllTables()
  );

  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current !== null) {
      window.clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  const startPolling = useCallback(
    (activeConnection: SpacetimeConnection) => {
      stopPolling();

      pollingIntervalRef.current = window.setInterval(() => {
        void refreshAllTables(activeConnection);
      }, spacetimeConfig.pollInterval);
    },
    [refreshAllTables, stopPolling]
  );

  const getTableData = useCallback(
    (tableName: string) => {
      return spacetimeState[tableName] || [];
    },
    [spacetimeState]
  );

  const users = useMemo(() => getTableData("user"), [getTableData]);
  const authEvents = useMemo(() => getTableData("auth_event"), [getTableData]);

  const currentUser = useMemo(() => {
    if (!users || users.length === 0) return null;

    if (!identity) {
      return users[0] || null;
    }

    const user = users.find(
      (item: any) =>
        item.currentIdentity === identity || item.current_identity === identity
    );

    return user || null;
  }, [users, identity]);

  const getUserByWalletAddress = useCallback(
    (walletAddress: string) => {
      if (!users || users.length === 0) return null;

      return (
        users.find(
          (user: any) =>
            user.walletAddress === walletAddress ||
            user.wallet_address === walletAddress
        ) || null
      );
    },
    [users]
  );

  const getCurrentUserAuthEvents = useMemo(() => {
    if (!authEvents || !currentUser) return [];

    const walletAddress = currentUser.walletAddress || currentUser.wallet_address;
    if (!walletAddress) return [];

    return authEvents
      .filter(
        (event: any) =>
          event.userWallet === walletAddress ||
          event.user_wallet === walletAddress
      )
      .sort((a: any, b: any) => {
        const aTime = a.timestamp || a.createdAt;
        const bTime = b.timestamp || b.createdAt;
        return new Date(bTime).getTime() - new Date(aTime).getTime();
      });
  }, [authEvents, currentUser]);

  useEffect(() => {
    discoveredTables.forEach((table) => {
      dispatch(initializeTable(table.name));
    });
  }, [dispatch, discoveredTables]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const connect = useCallback(
    async (retryCount = 0) => {
      if (connectionState.isConnecting() || isConnected) {
        return;
      }

      connectionState.setConnecting(true);
      connectionState.setIntentionalDisconnect(false);
      dispatch(setConnectionStatus("connecting"));
      dispatch(clearErrorAction());

      try {
        const existingToken = localStorage.getItem("spacetimedb_token");
        const client = new SpacetimeHttpClient(
          spacetimeConfig.uri,
          spacetimeConfig.moduleName
        );

        const identityResponse = await client.getOrCreateIdentity(existingToken);
        const token = identityResponse.token || existingToken;

        if (token) {
          localStorage.setItem("spacetimedb_token", token);
        }

        const { tables } = await spacetimeIntrospector.discoverSchema(
          client,
          token
        );

        tables.forEach((table) => {
          dispatch(initializeTable(table.name));
        });

        const nextConnection: SpacetimeConnection = {
          client,
          token: token || null,
          identity: identityResponse.identity,
        };

        dispatch(setIdentity(identityResponse.identity));
        dispatch(setConnection(nextConnection));
        dispatch(setConnectionStatus("connected"));
        connectionState.setConnecting(false);

        await refreshAllTables(nextConnection);
        setupReducerHandlers();
        startPolling(nextConnection);
      } catch (caughtError) {
        if (!connectionState.isIntentionalDisconnect()) {
          connectionState.setConnecting(false);

          if (retryCount < spacetimeConfig.maxRetries) {
            const retryDelay =
              spacetimeConfig.retryBackoffMultiplier * 1000 * (retryCount + 1);
            setTimeout(() => {
              void connect(retryCount + 1);
            }, retryDelay);
          } else {
            const errorMessage =
              caughtError instanceof Error
                ? caughtError.message
                : "Unknown connection error";
            dispatch(
              setError(
                `Connection failed after ${spacetimeConfig.maxRetries} attempts: ${errorMessage}`
              )
            );
            dispatch(setConnectionStatus("error"));
          }
        } else {
          connectionState.setConnecting(false);
          connectionState.setIntentionalDisconnect(false);
          dispatch(setConnectionStatus("disconnected"));
        }
      }
    },
    [
      connectionState,
      dispatch,
      isConnected,
      refreshAllTables,
      setupReducerHandlers,
      startPolling,
    ]
  );

  const disconnect = useCallback(() => {
    if (connection) {
      connectionState.setIntentionalDisconnect(true);
      connectionState.setConnecting(false);

      stopPolling();
      dispatch(setConnectionStatus("disconnected"));
      dispatch(setConnection(null));
      dispatch(clearAllTables());

      setTimeout(() => {
        connectionState.setIntentionalDisconnect(false);
      }, 1000);
    }
  }, [connection, connectionState, dispatch, stopPolling]);

  const clearError = useCallback(() => {
    dispatch(clearErrorAction());
  }, [dispatch]);

  const refreshSchema = useCallback(async () => {
    const activeConnection = connection as SpacetimeConnection | null;
    if (!activeConnection) {
      return { tables: [], reducers: [] };
    }

    const schema = await spacetimeIntrospector.discoverSchema(
      activeConnection.client,
      activeConnection.token
    );

    schema.tables.forEach((table) => {
      dispatch(initializeTable(table.name));
    });

    await refreshAllTables(activeConnection);

    return schema;
  }, [connection, dispatch, refreshAllTables]);

  const handleTableInsert = useCallback(
    (tableName: string, row: any) => {
      dispatch(insertTableRow({ tableName, row }));
    },
    [dispatch]
  );

  const handleTableUpdate = useCallback(
    (tableName: string, primaryKey: string, primaryValue: any, row: any) => {
      dispatch(updateTableRow({ tableName, primaryKey, primaryValue, row }));
    },
    [dispatch]
  );

  const handleTableDelete = useCallback(
    (tableName: string, primaryKey: string, primaryValue: any) => {
      dispatch(deleteTableRow({ tableName, primaryKey, primaryValue }));
    },
    [dispatch]
  );

  const refreshCurrentUser = useCallback(() => {
    if (isConnected) {
      void callReducer("get_current_user", {});
    }
  }, [callReducer, isConnected]);

  const updateUserProfile = useCallback(
    async (nickname?: string) => {
      if (!isConnected) {
        throw new Error("Not connected to SpacetimeDB");
      }

      await callReducer("update_user_profile", { nickname: nickname || null });

      setTimeout(() => {
        refreshCurrentUser();
      }, 500);
    },
    [callReducer, isConnected, refreshCurrentUser]
  );

  return {
    connection,
    connectionStatus,
    identity,
    error,
    isConnected,
    isConnecting,

    connect,
    disconnect,
    clearError,

    callReducer,

    registerEventCallbacks,
    unregisterEventCallbacks,

    discoveredTables,
    discoveredReducers,
    refreshSchema,

    handleTableInsert,
    handleTableUpdate,
    handleTableDelete,

    getTableData,
    users,
    authEvents,

    currentUser,
    isCurrentUserAdmin: true,
    getCurrentUserAuthEvents,
    getUserByWalletAddress,
    refreshCurrentUser,
    updateUserProfile,
  };
};
