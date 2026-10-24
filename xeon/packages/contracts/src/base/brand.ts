declare const brandTag: unique symbol;

/** 같은 원시 타입끼리 섞이지 않게 하는 이름표. 런타임 값은 원시 값 그대로다. */
export type Brand<T, Name extends string> = T & { readonly [brandTag]: Name };
