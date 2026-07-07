/**
 * Minimal dependency-injection container.
 *
 * Services are keyed by typed tokens so `resolve` is fully type-safe without
 * decorators or reflection metadata (both unavailable/undesirable in a
 * bundler-portable Vite setup).
 */
export class Token<T> {
  // Phantom field ties the generic parameter to the token instance so two
  // tokens with different T are not assignable to each other.
  declare private readonly _type: T;

  constructor(public readonly description: string) {}

  toString(): string {
    return `Token(${this.description})`;
  }
}

export function createToken<T>(description: string): Token<T> {
  return new Token<T>(description);
}

export interface Disposable {
  dispose(): void;
}

function isDisposable(value: unknown): value is Disposable {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Disposable).dispose === 'function'
  );
}

type Factory<T> = (container: ServiceContainer) => T;

interface Registration<T> {
  factory: Factory<T>;
  singleton: boolean;
  instance?: T;
  instantiated: boolean;
}

export class ServiceContainer implements Disposable {
  private readonly registrations = new Map<Token<unknown>, Registration<unknown>>();
  private readonly resolving = new Set<Token<unknown>>();

  registerValue<T>(token: Token<T>, value: T): this {
    this.registrations.set(token as Token<unknown>, {
      factory: () => value,
      singleton: true,
      instance: value,
      instantiated: true,
    });
    return this;
  }

  registerFactory<T>(
    token: Token<T>,
    factory: Factory<T>,
    options: { singleton?: boolean } = {},
  ): this {
    this.registrations.set(token as Token<unknown>, {
      factory: factory as Factory<unknown>,
      singleton: options.singleton ?? true,
      instantiated: false,
    });
    return this;
  }

  has(token: Token<unknown>): boolean {
    return this.registrations.has(token);
  }

  resolve<T>(token: Token<T>): T {
    const registration = this.registrations.get(token as Token<unknown>) as
      | Registration<T>
      | undefined;
    if (!registration) {
      throw new Error(`ServiceContainer: no registration for ${token.toString()}`);
    }
    if (registration.singleton && registration.instantiated) {
      return registration.instance as T;
    }
    if (this.resolving.has(token as Token<unknown>)) {
      throw new Error(
        `ServiceContainer: circular dependency while resolving ${token.toString()}`,
      );
    }
    this.resolving.add(token as Token<unknown>);
    try {
      const instance = registration.factory(this);
      if (registration.singleton) {
        registration.instance = instance;
        registration.instantiated = true;
      }
      return instance;
    } finally {
      this.resolving.delete(token as Token<unknown>);
    }
  }

  /** Dispose all instantiated singletons (in reverse registration order). */
  dispose(): void {
    const entries = [...this.registrations.values()].reverse();
    for (const registration of entries) {
      if (registration.instantiated && isDisposable(registration.instance)) {
        registration.instance.dispose();
      }
      registration.instance = undefined;
      registration.instantiated = false;
    }
    this.registrations.clear();
  }
}
