// Jest stub for convex/_generated/server — allows unit-testing pure functions
// that live in the same file as Convex query/mutation definitions.
const noop = (x: any) => x;
export const query = noop;
export const internalQuery = noop;
export const mutation = noop;
export const internalMutation = noop;
export const action = noop;
export const internalAction = noop;
export const httpAction = noop;
