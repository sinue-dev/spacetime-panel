export interface AlgebraicType {
  [typeName: string]: unknown;
}

// Raw column element inside a ProductType (used for reducer params and typespace entries)
export interface ProductTypeElement {
  name: string | null;
  algebraic_type: AlgebraicType;
}

// The typespace holds an array of AlgebraicType entries referenced by index.
// A Product type looks like: { "Product": { "elements": [...] } }
export interface ProductAlgebraicType {
  Product: {
    elements: ProductTypeElement[];
  };
}

export interface Typespace {
  // Each entry is an AlgebraicType (could be Product, Sum, etc.)
  types: Array<AlgebraicType | ProductAlgebraicType>;
}

// RawTableDefV9: columns are NOT inline – they live in typespace.types[product_type_ref]
export interface TableSchema {
  name: string;
  product_type_ref: number;
  // primary_key is a ColList; in SATS JSON it serialises as an array of column indices
  primary_key: number[] | { data: number[] };
  indexes: unknown[];
  constraints: unknown[];
}

export interface ParamSchema {
  name: string | null;
  algebraic_type: AlgebraicType;
}

export interface ReducerSchema {
  name: string;
  params: {
    elements: ParamSchema[];
  };
  lifecycle?: string | null;
}

// RawModuleDefV9 top-level shape (wrapped in sats::serde::SerdeWrapper)
export interface SpacetimeSchema {
  typespace: Typespace;
  tables: TableSchema[];
  reducers: ReducerSchema[];
  types?: unknown[];
  misc_exports?: unknown[];
  row_level_security?: unknown[];
}

// SqlStmtResult<ProductValue>: schema is a ProductType object, rows are arrays of values
export interface SqlResult {
  schema: {
    elements?: Array<{ name: string | null; algebraic_type: AlgebraicType }>;
  };
  rows: unknown[][];
  total_duration_micros?: number;
  stats?: unknown;
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

/**
 * Decode a SpacetimeDB JWT and extract the `hex_identity` claim.
 * SpacetimeDB tokens are ES256 JWTs whose payload includes `hex_identity`.
 * We only need to base64-decode the payload; we do NOT verify the signature here.
 */
const extractIdentityFromToken = (token: string): string => {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return "";
    // JWT uses URL-safe base64 without padding
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(base64);
    const payload = JSON.parse(json) as Record<string, unknown>;
    return typeof payload["hex_identity"] === "string"
      ? payload["hex_identity"]
      : "";
  } catch {
    return "";
  }
};

export class SpacetimeHttpClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string, private readonly moduleName: string) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
  }

  private getJsonHeaders(token?: string | null): HeadersInit {
    const headers: HeadersInit = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return headers;
  }

  private getAuthHeaders(token?: string | null): HeadersInit {
    const headers: HeadersInit = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return headers;
  }

  private buildDbUrl(path: string): string {
    return `${this.baseUrl}/v1/database/${encodeURIComponent(this.moduleName)}${path}`;
  }

  /**
   * GET /v1/database/{module}/schema?version=9
   *
   * Returns a RawModuleDefV9 (SerdeWrapper-serialised).  The `version=9` query
   * parameter is **required** by the SpacetimeDB server; omitting it results in
   * a 400 / 422 error.
   */
  async getSchema(token?: string | null): Promise<SpacetimeSchema> {
    const url = this.buildDbUrl("/schema?version=9");
    const response = await fetch(url, {
      method: "GET",
      headers: this.getAuthHeaders(token),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch schema: ${await readErrorMessage(response)}`
      );
    }

    return response.json() as Promise<SpacetimeSchema>;
  }

  /**
   * POST /v1/database/{module}/sql
   *
   * The body must be the raw SQL string (plain text), NOT a JSON object.
   * The Axum handler extracts it as `body: String`.
   */
  async querySql(sql: string, token?: string | null): Promise<SqlResult[]> {
    const response = await fetch(this.buildDbUrl("/sql"), {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: sql,
    });

    if (!response.ok) {
      throw new Error(
        `Failed to execute SQL: ${await readErrorMessage(response)}`
      );
    }

    return response.json() as Promise<SqlResult[]>;
  }

  /**
   * POST /v1/database/{module}/call/{reducerName}
   *
   * Body is a JSON array of ordered reducer arguments.
   */
  async callReducer(
    reducerName: string,
    args: unknown[],
    token?: string | null
  ): Promise<void> {
    const response = await fetch(
      this.buildDbUrl(`/call/${encodeURIComponent(reducerName)}`),
      {
        method: "POST",
        headers: this.getJsonHeaders(token),
        body: JSON.stringify(args),
      }
    );

    if (!response.ok) {
      throw new Error(
        `Failed to call reducer: ${await readErrorMessage(response)}`
      );
    }
  }

  /**
   * POST /v1/identity
   *
   * Creates a brand-new identity + JWT token.  This is a **global** endpoint
   * (not scoped to a database module).  It must only be called when the client
   * does NOT already have a stored token; calling it again would allocate a
   * different identity, losing the previous one.
   *
   * When `existingToken` is provided the token is reused and the identity is
   * extracted locally from the JWT `hex_identity` claim – no network round-trip
   * is needed.
   */
  async getOrCreateIdentity(
    existingToken?: string | null
  ): Promise<IdentityResponse> {
    if (existingToken) {
      const identity = extractIdentityFromToken(existingToken);
      return { token: existingToken, identity };
    }

    // No stored token – allocate a new identity from the server.
    const response = await fetch(`${this.baseUrl}/v1/identity`, {
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(
        `Failed to create identity: ${await readErrorMessage(response)}`
      );
    }

    return response.json() as Promise<IdentityResponse>;
  }
}
