import { TypeAnalyzer } from "./type-analyzer";
import { DescriptionGenerator } from "./description-generator";
import { ExampleGenerator } from "./example-generator";
import { categorizeItem, getIconForItem } from "./categorization";
import { ReducerMetadata, TableMetadata } from "@/types/spacetime";
import {
  AlgebraicType,
  ProductAlgebraicType,
  ReducerSchema,
  SpacetimeHttpClient,
  SpacetimeSchema,
  TableSchema,
} from "@/lib/spacetime-http";

export class SpacetimeIntrospector {
  private typeAnalyzer = new TypeAnalyzer();
  private descriptionGenerator = new DescriptionGenerator();
  private schemaCache: SpacetimeSchema | null = null;

  async discoverSchema(
    client: SpacetimeHttpClient,
    token?: string | null
  ): Promise<{ tables: TableMetadata[]; reducers: ReducerMetadata[] }> {
    const schema = await client.getSchema(token);
    this.schemaCache = schema;

    return {
      tables: this.discoverTables(),
      reducers: this.discoverReducers(),
    };
  }

  discoverTables(): TableMetadata[] {
    const tables = this.schemaCache?.tables || [];

    return tables
      .map((table) => this.buildTableMetadata(table))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  discoverReducers(): ReducerMetadata[] {
    const reducers = this.schemaCache?.reducers || [];

    return reducers
      .map((reducer) => this.buildReducerMetadata(reducer))
      .sort((a, b) => {
        if (a.category !== b.category) {
          return a.category.localeCompare(b.category);
        }
        return a.displayName.localeCompare(b.displayName);
      });
  }

  private buildTableMetadata(table: TableSchema): TableMetadata {
    // Resolve columns from the typespace using the product_type_ref index.
    // The entry at typespace.types[product_type_ref] is expected to be a
    // Product AlgebraicType: { "Product": { "elements": [...] } }
    const typeEntry =
      this.schemaCache?.typespace?.types?.[table.product_type_ref];
    const productType = typeEntry as ProductAlgebraicType | undefined;
    const elements: Array<{ name: string | null; algebraic_type: AlgebraicType }> =
      productType?.Product?.elements ?? [];

    const fields = elements
      .filter((el) => el.name != null)
      .map((el) =>
        this.typeAnalyzer.analyzeColumn(el.name as string, el.algebraic_type)
      );

    return {
      name: table.name,
      displayName: this.formatDisplayName(table.name),
      primaryKey: this.inferPrimaryKey(table, fields, elements),
      fields,
      icon: getIconForItem(table.name),
      category: categorizeItem(table.name),
      description: this.descriptionGenerator.generateTableDescription(
        table.name,
        fields
      ),
      actions: this.inferTableActions(table.name, fields),
    };
  }

  private buildReducerMetadata(reducer: ReducerSchema): ReducerMetadata {
    const params = reducer.params?.elements || [];
    const fields = params
      .filter((param) => param.name != null)
      .map((param) =>
        this.typeAnalyzer.analyzeColumn(param.name as string, param.algebraic_type)
      );
    const isDestructive = this.isDestructiveReducer(reducer.name);

    return {
      name: reducer.name,
      displayName: this.formatDisplayName(reducer.name),
      description: this.descriptionGenerator.generateReducerDescription(
        reducer.name,
        fields
      ),
      category: categorizeItem(reducer.name),
      fields,
      icon: getIconForItem(reducer.name),
      color: this.getReducerColor(reducer.name, isDestructive),
      isDestructive,
      exampleArgs: ExampleGenerator.generateExampleArgs(fields),
    };
  }

  private inferPrimaryKey(
    table: TableSchema,
    fields: any[],
    elements: Array<{ name: string | null; algebraic_type: AlgebraicType }>
  ): string {
    // primary_key is a ColList; in SATS JSON it may be `[0]` or `{"data": [0]}`
    const rawPk = table.primary_key;
    const pkIndices: number[] = Array.isArray(rawPk)
      ? rawPk
      : (rawPk as { data: number[] }).data ?? [];

    const firstIndex = pkIndices[0];
    if (typeof firstIndex === "number" && firstIndex >= 0 && firstIndex < elements.length) {
      const colName = elements[firstIndex].name;
      if (colName) return colName;
    }

    const idField = fields.find(
      (f) => f.name === "id" || f.name.endsWith("_id") || f.name === "identity"
    );
    return idField?.name || (fields.length > 0 ? fields[0].name : "id");
  }

  private inferTableActions(tableName: string, fields: any[]): string[] {
    const actions = ["view", "export"];

    if (fields.some((f) => f.name.includes("id"))) {
      actions.push("search", "filter");
    }

    const actionsByType: Record<string, string[]> = {
      user: ["ban", "promote"],
      player: ["ban", "promote"],
      room: ["close", "moderate"],
      session: ["close", "moderate"],
      config: ["edit", "reset"],
      setting: ["edit", "reset"],
    };

    for (const [type, typeActions] of Object.entries(actionsByType)) {
      if (tableName.includes(type)) {
        actions.push(...typeActions);
        break;
      }
    }

    return actions;
  }

  private isDestructiveReducer(reducerName: string): boolean {
    const destructivePatterns = [
      "delete",
      "remove",
      "destroy",
      "clear",
      "reset",
      "purge",
      "ban",
      "kick",
      "terminate",
      "cancel",
      "abort",
    ];

    return destructivePatterns.some((pattern) =>
      reducerName.toLowerCase().includes(pattern)
    );
  }

  private getReducerColor(reducerName: string, isDestructive: boolean): string {
    if (isDestructive) return "red";

    const name = reducerName.toLowerCase();

    const colorPatterns: Record<string, string[]> = {
      green: ["create", "add", "register"],
      blue: ["update", "modify", "edit"],
      emerald: ["join", "connect"],
      orange: ["leave", "disconnect"],
      purple: ["open", "unlock"],
      indigo: ["generate", "produce"],
    };

    for (const [color, patterns] of Object.entries(colorPatterns)) {
      if (patterns.some((pattern) => name.includes(pattern))) {
        return color;
      }
    }

    return "gray";
  }

  private formatDisplayName(name: string): string {
    return name
      .split(/[_\s]+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }
}

export const spacetimeIntrospector = new SpacetimeIntrospector();
