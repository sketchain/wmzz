/**
 * Component type registry.
 *
 * Three component kinds, chosen per data shape:
 *  - 'soa'    numeric hot data (positions, velocities, meters) stored as
 *             Structure-of-Arrays typed arrays → cache-friendly iteration
 *             and zero-copy transfer to Web Workers later.
 *  - 'tag'    zero-size markers (Selected, Abandoned, OnFire…). They live
 *             only in the entity signature bitmask — no storage at all.
 *  - 'object' cold/complex data (path arrays, names, config refs) stored as
 *             plain JS objects in a dense array.
 *
 * Types are registered at module load time and receive a stable numeric id
 * used as the bit position inside entity signatures.
 */

export type FieldType = 'f32' | 'f64' | 'i8' | 'i16' | 'i32' | 'u8' | 'u16' | 'u32';

export type ComponentSchema = Record<string, FieldType>;

/** Signature bitmask sizing: supports up to 256 registered component types. */
export const MAX_COMPONENT_TYPES = 256;
export const SIGNATURE_WORDS = MAX_COMPONENT_TYPES / 32;

export interface SoaComponentType<S extends ComponentSchema = ComponentSchema> {
  readonly kind: 'soa';
  readonly id: number;
  readonly name: string;
  readonly schema: S;
  readonly defaults: Readonly<Partial<Record<keyof S, number>>>;
}

export interface TagComponentType {
  readonly kind: 'tag';
  readonly id: number;
  readonly name: string;
}

export interface ObjectComponentType<T = unknown> {
  readonly kind: 'object';
  readonly id: number;
  readonly name: string;
  // Phantom field binding T to the type; never assigned at runtime.
  readonly _type?: T;
}

export type AnyComponentType =
  | SoaComponentType<ComponentSchema>
  | TagComponentType
  | ObjectComponentType<unknown>;

export type SoaValues<S extends ComponentSchema> = Partial<Record<keyof S, number>>;

const registryByName = new Map<string, AnyComponentType>();
const registryById: AnyComponentType[] = [];

function allocateId(name: string): number {
  if (registryByName.has(name)) {
    throw new Error(`Component "${name}" is already registered`);
  }
  const id = registryById.length;
  if (id >= MAX_COMPONENT_TYPES) {
    throw new Error(
      `Component type limit reached (${MAX_COMPONENT_TYPES}); raise MAX_COMPONENT_TYPES`,
    );
  }
  return id;
}

export function defineComponent<S extends ComponentSchema>(
  name: string,
  schema: S,
  defaults: Partial<Record<keyof S, number>> = {},
): SoaComponentType<S> {
  const id = allocateId(name);
  const type: SoaComponentType<S> = { kind: 'soa', id, name, schema, defaults };
  registryByName.set(name, type);
  registryById.push(type);
  return type;
}

export function defineTag(name: string): TagComponentType {
  const id = allocateId(name);
  const type: TagComponentType = { kind: 'tag', id, name };
  registryByName.set(name, type);
  registryById.push(type);
  return type;
}

export function defineObjectComponent<T>(name: string): ObjectComponentType<T> {
  const id = allocateId(name);
  const type: ObjectComponentType<T> = { kind: 'object', id, name };
  registryByName.set(name, type);
  registryById.push(type);
  return type;
}

export function componentTypeById(id: number): AnyComponentType | undefined {
  return registryById[id];
}

export function componentTypeByName(name: string): AnyComponentType | undefined {
  return registryByName.get(name);
}

export function registeredComponentCount(): number {
  return registryById.length;
}

/** Test-only: wipe the registry so isolated suites can re-register types. */
export function resetComponentRegistry(): void {
  registryByName.clear();
  registryById.length = 0;
}
