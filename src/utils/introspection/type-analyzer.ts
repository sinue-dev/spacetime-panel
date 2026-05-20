import { safeStringify } from "@/utils/serialization";
import { FieldMetadata } from "@/types/spacetime";

export class TypeAnalyzer {
  private typeCache = new Map<string, FieldMetadata[]>();

  analyzeAlgebraicType(type: any, name = ""): FieldMetadata[] {
    const cacheKey = `${name}:${safeStringify(type)}`;

    if (this.typeCache.has(cacheKey)) {
      return this.typeCache.get(cacheKey)!;
    }

    let fields: FieldMetadata[] = [];

    if (this.isProductType(type)) {
      fields = (type.Product?.elements || []).map((element: any) =>
        this.createField(
          element.name || "unknown",
          element.algebraic_type || element.algebraicType
        )
      );
    } else {
      fields = [this.createField(name || "value", type)];
    }

    this.typeCache.set(cacheKey, fields);
    return fields;
  }

  analyzeColumn(name: string, algebraicType: any): FieldMetadata {
    return this.createField(name, algebraicType);
  }

  private createField(name: string, algebraicType: any): FieldMetadata {
    const normalized = this.unwrapOptionType(algebraicType);
    const typeString = this.getTypeString(normalized.type);
    const enumValues = this.extractEnumValues(normalized.type);

    return {
      name,
      type: typeString,
      isOptional: normalized.isOptional,
      isArray: this.isArrayType(normalized.type),
      displayName: this.formatDisplayName(name),
      inputType: this.inferInputType(typeString, name),
      validation: this.generateValidation(typeString, name, normalized.isOptional),
      enumValues,
      _enumConstructor: undefined,
    };
  }

  private unwrapOptionType(type: any): { type: any; isOptional: boolean } {
    if (!type || typeof type !== "object") {
      return { type, isOptional: false };
    }

    if ("Option" in type) {
      return { type: type.Option, isOptional: true };
    }

    return { type, isOptional: false };
  }

  private getTypeString(type: any): string {
    if (!type || typeof type !== "object") return "unknown";

    const keys = Object.keys(type);
    const typeName = keys[0];

    const primitiveMap: Record<string, string> = {
      Bool: "boolean",
      U8: "u8",
      U16: "u16",
      U32: "u32",
      U64: "u64",
      U128: "u128",
      U256: "u256",
      I8: "i8",
      I16: "i16",
      I32: "i32",
      I64: "i64",
      I128: "i128",
      I256: "i256",
      F32: "f32",
      F64: "f64",
      String: "string",
      Identity: "Identity",
      ConnectionId: "ConnectionId",
      Timestamp: "Timestamp",
      TimeDuration: "TimeDuration",
      ScheduleAt: "ScheduleAt",
    };

    if (typeName in primitiveMap) {
      return primitiveMap[typeName];
    }

    if (typeName === "Array") {
      return `Array<${this.getTypeString(type.Array)}>`;
    }

    if (typeName === "Map") {
      const keyType = this.getTypeString(type.Map?.key || type.Map?.key_type);
      const valueType = this.getTypeString(type.Map?.value || type.Map?.value_type);
      return `Map<${keyType}, ${valueType}>`;
    }

    if (typeName === "Sum") {
      return "enum";
    }

    if (typeName === "Product") {
      return "object";
    }

    return "unknown";
  }

  private isProductType(type: any): boolean {
    return Boolean(type && typeof type === "object" && "Product" in type);
  }

  private isArrayType(type: any): boolean {
    return Boolean(type && typeof type === "object" && "Array" in type);
  }

  private extractEnumValues(type: any): string[] | undefined {
    if (!type || typeof type !== "object" || !("Sum" in type)) {
      return undefined;
    }

    const variants = type.Sum?.variants;
    if (!Array.isArray(variants)) {
      return undefined;
    }

    return variants.map((variant: any) => variant.name).filter(Boolean);
  }

  private inferInputType(
    typeString: string,
    fieldName: string
  ): FieldMetadata["inputType"] {
    const lowerName = fieldName.toLowerCase();

    if (typeString === "enum") return "select";
    if (typeString === "boolean") return "boolean";

    const patterns: Record<string, FieldMetadata["inputType"]> = {
      email: "email",
      mail: "email",
      password: "password",
      secret: "password",
      token: "password",
      url: "url",
      link: "url",
      website: "url",
      description: "textarea",
      content: "textarea",
      message: "textarea",
      comment: "textarea",
      bio: "textarea",
      about: "textarea",
    };

    for (const [pattern, inputType] of Object.entries(patterns)) {
      if (lowerName.includes(pattern)) return inputType;
    }

    if (
      lowerName.includes("date") ||
      lowerName.includes("time") ||
      lowerName.includes("created") ||
      lowerName.includes("updated") ||
      typeString === "Timestamp"
    ) {
      return "date";
    }

    if (/^[ui](8|16|32|64|128|256)$|^i(8|16|32|64|128|256)$|^f(32|64)$/.test(typeString)) {
      return "number";
    }

    return "text";
  }

  private generateValidation(
    typeString: string,
    fieldName: string,
    isOptional: boolean
  ): FieldMetadata["validation"] {
    const validation: FieldMetadata["validation"] = {};
    const lowerName = fieldName.toLowerCase();

    if (!isOptional && !lowerName.includes("optional")) {
      validation.required = true;
    }

    const numericLimits: Record<string, { min: number; max: number }> = {
      u8: { min: 0, max: 255 },
      u16: { min: 0, max: 65535 },
      u32: { min: 0, max: 4294967295 },
    };

    if (typeString in numericLimits) {
      const { min, max } = numericLimits[typeString];
      validation.min = min;
      validation.max = max;
    }

    if (typeString === "string") {
      if (lowerName.includes("email")) {
        validation.pattern = "^[^@]+@[^@]+\\.[^@]+$";
      } else if (lowerName.includes("url")) {
        validation.pattern = "^https?://.*";
      }
    }

    return validation;
  }

  private formatDisplayName(name: string): string {
    return name
      .split(/[\s_]+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }
}
