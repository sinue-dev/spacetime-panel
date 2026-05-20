export interface AlgebraicType {
  [typeName: string]: unknown;
}

export interface ColumnSchema {
  name: string;
  algebraic_type: AlgebraicType;
}

export interface TableSchema {
  name: string;
  columns: ColumnSchema[];
  primary_key: number[];
}

export interface ParamSchema {
  name: string;
  algebraic_type: AlgebraicType;
}

export interface ReducerSchema {
  name: string;
  params: {
    elements: ParamSchema[];
  };
}

export interface SpacetimeSchema {
  tables: TableSchema[];
  reducers: ReducerSchema[];
}

export interface SqlResult {
  schema: {
    elements?: Array<{ name: string }>;
  };
  rows: unknown[][];
}

export interface IdentityResponse {
  token: string;
  identity: string;
}

export interface SpacetimeConnection {
  client: SpacetimeHttpClient;
  token: string | null;
  identity: string;
}

const normalizeBaseUrl = (baseUrl: string): string => baseUrl.replace(/\/$/, "");

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const text = await response.text();
    return text || `${response.status} ${response.statusText}`;
  } catch {
    return `${response.status} ${response.statusText}`;
  }
};

export class SpacetimeHttpClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string, private readonly moduleName: string) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
  }

  private getHeaders(token?: string | null): HeadersInit {
    const headers: HeadersInit = { "Content-Type": "application/json" };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }

  private buildUrl(path: string): string {
    return `${this.baseUrl}/v1/database/${encodeURIComponent(this.moduleName)}${path}`;
  }

  async getSchema(token?: string | null): Promise<SpacetimeSchema> {
    const response = await fetch(this.buildUrl("/schema"), {
      method: "GET",
      headers: this.getHeaders(token),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch schema: ${await readErrorMessage(response)}`);
    }

    return response.json() as Promise<SpacetimeSchema>;
  }

  async querySql(sql: string, token?: string | null): Promise<SqlResult[]> {
    const response = await fetch(this.buildUrl("/sql"), {
      method: "POST",
      headers: this.getHeaders(token),
      body: JSON.stringify({ query: sql }),
    });

    if (!response.ok) {
      throw new Error(`Failed to execute SQL: ${await readErrorMessage(response)}`);
    }

    return response.json() as Promise<SqlResult[]>;
  }

  async callReducer(
    reducerName: string,
    args: unknown[],
    token?: string | null
  ): Promise<void> {
    const response = await fetch(
      this.buildUrl(`/call/${encodeURIComponent(reducerName)}`),
      {
        method: "POST",
        headers: this.getHeaders(token),
        body: JSON.stringify(args),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to call reducer: ${await readErrorMessage(response)}`);
    }
  }

  async getOrCreateIdentity(token?: string | null): Promise<IdentityResponse> {
    const response = await fetch(this.buildUrl("/identity"), {
      method: "POST",
      headers: this.getHeaders(token),
    });

    if (!response.ok) {
      throw new Error(`Failed to get identity: ${await readErrorMessage(response)}`);
    }

    return response.json() as Promise<IdentityResponse>;
  }
}
