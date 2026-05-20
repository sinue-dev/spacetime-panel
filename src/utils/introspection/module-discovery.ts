import { SpacetimeSchema } from "@/lib/spacetime-http";

export class ModuleDiscovery {
  findTableTypes(schema: SpacetimeSchema): string[] {
    return (schema.tables || []).map((table) => table.name);
  }

  findReducerTypes(schema: SpacetimeSchema): string[] {
    return (schema.reducers || []).map((reducer) => reducer.name);
  }
}
