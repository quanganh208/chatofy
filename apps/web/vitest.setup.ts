/**
 * Every component spec renders through `act()`, and React only trusts `act()`
 * when this flag is set. Without it each call logs "The current testing
 * environment is not configured to support act(...)" — over five thousand lines
 * per run, all from passing specs. Set once here so a new spec cannot forget it.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
