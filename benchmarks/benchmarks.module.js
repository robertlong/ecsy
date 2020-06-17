class PerfStats {
  constructor() {
    this.n = 0;
    this.min = Number.MAX_VALUE;
    this.max = -Number.MAX_VALUE;
    this.sum = 0;
    this.mean = 0;
    this.q = 0;
  }

  get variance() {
    return this.q / this.n;
  }

  get standard_deviation() {
    return Math.sqrt(this.q / this.n);
  }

  update(value) {
    var num = parseFloat(value);
    if (isNaN(num)) {
      // Sorry, no NaNs
      return;
    }
    this.n++;
    this.min = Math.min(this.min, num);
    this.max = Math.max(this.max, num);
    this.sum += num;
    const prevMean = this.mean;
    this.mean = this.mean + (num - this.mean) / this.n;
    this.q = this.q + (num - prevMean) * (num - this.mean);
  }

  getAll() {
    return {
      n: this.n,
      min: this.min,
      max: this.max,
      sum: this.sum,
      mean: this.mean,
      variance: this.variance,
      standard_deviation: this.standard_deviation
    };
  }  
}

const DEFAULT_GLOBAL_OPTIONS = {
  verbose: false
};

const DEFAULT_OPTIONS = {
  gc: true
};

class Benchmarks {
  constructor(globalOptions, benchDefaultOptions) {
    this.benchs = [];
    this.options = Object.assign(DEFAULT_GLOBAL_OPTIONS, globalOptions);
    this.benchDefaultOptions = Object.assign(DEFAULT_OPTIONS, benchDefaultOptions);
  }
  add(bench) {
    // options = {}
    if (!bench.options) {
      bench.options = this.benchDefaultOptions;
    } else {
      bench.options = Object.assign(this.benchDefaultOptions, bench.options);
    }

    this.benchs.push(bench);
    return this;
  }

  run() {
    this.benchs.forEach(bench => {
      let stats = new PerfStats();
      let context = {};
      if (bench.prepareGlobal) {
        bench.prepareGlobal(context);
      }

      for (let i = 0; i < bench.iterations; i++) {
        if (bench.prepare) {
          bench.prepare(context);
        }

        let t0 = Date.now();
        bench.execute(context);
        let total = Date.now() - t0;
        stats.update(total);

        if (bench.options.gc) {
          global.gc();
        }

        // @todo Logging options
        if (this.options.verbose) {
          console.log(
            `${bench.name} ${(i + 1).toString().padStart(2)}/${
              bench.iterations
            }: ${total}ms`
          );
        }
      }

      if (this.options.verbose) {
        console.log(
          `${"=".repeat(60)}\n${bench.name} - ${bench.iterations} iterations`
        );
        console.log("-".repeat(60));
        console.log(stats.getAll());
        console.log("=".repeat(60));
      }
    });
  }
}

/**
 * Return the name of a component
 * @param {Component} Component
 * @private
 */
function getName(Component) {
  return Component.name;
}

/**
 * Return a valid property name for the Component
 * @param {Component} Component
 * @private
 */
function componentPropertyName(Component) {
  return getName(Component);
}

/**
 * Get a key from a list of components
 * @param {Array(Component)} Components Array of components to generate the key
 * @private
 */
function queryKey(Components) {
  var names = [];
  for (var n = 0; n < Components.length; n++) {
    var T = Components[n];
    if (typeof T === "object") {
      var operator = T.operator === "not" ? "!" : T.operator;
      names.push(operator + getName(T.Component));
    } else {
      names.push(getName(T));
    }
  }

  return names.sort().join("-");
}

// Detector for browser's "window"
const hasWindow = typeof window !== "undefined";

// performance.now() "polyfill"
const now =
  hasWindow && typeof window.performance !== "undefined"
    ? performance.now.bind(performance)
    : Date.now.bind(Date);

/**
 * @private
 * @class EventDispatcher
 */
class EventDispatcher {
  constructor() {
    this._listeners = {};
    this.stats = {
      fired: 0,
      handled: 0
    };
  }

  /**
   * Add an event listener
   * @param {String} eventName Name of the event to listen
   * @param {Function} listener Callback to trigger when the event is fired
   */
  addEventListener(eventName, listener) {
    let listeners = this._listeners;
    if (listeners[eventName] === undefined) {
      listeners[eventName] = [];
    }

    if (listeners[eventName].indexOf(listener) === -1) {
      listeners[eventName].push(listener);
    }
  }

  /**
   * Check if an event listener is already added to the list of listeners
   * @param {String} eventName Name of the event to check
   * @param {Function} listener Callback for the specified event
   */
  hasEventListener(eventName, listener) {
    return (
      this._listeners[eventName] !== undefined &&
      this._listeners[eventName].indexOf(listener) !== -1
    );
  }

  /**
   * Remove an event listener
   * @param {String} eventName Name of the event to remove
   * @param {Function} listener Callback for the specified event
   */
  removeEventListener(eventName, listener) {
    var listenerArray = this._listeners[eventName];
    if (listenerArray !== undefined) {
      var index = listenerArray.indexOf(listener);
      if (index !== -1) {
        listenerArray.splice(index, 1);
      }
    }
  }

  /**
   * Dispatch an event
   * @param {String} eventName Name of the event to dispatch
   * @param {Entity} entity (Optional) Entity to emit
   * @param {Component} component
   */
  dispatchEvent(eventName, entity, component) {
    this.stats.fired++;

    var listenerArray = this._listeners[eventName];
    if (listenerArray !== undefined) {
      var array = listenerArray.slice(0);

      for (var i = 0; i < array.length; i++) {
        array[i].call(this, entity, component);
      }
    }
  }

  /**
   * Reset stats counters
   */
  resetCounters() {
    this.stats.fired = this.stats.handled = 0;
  }
}

class Query {
  /**
   * @param {Array(Component)} Components List of types of components to query
   */
  constructor(Components, manager) {
    this.Components = [];
    this.NotComponents = [];

    Components.forEach(component => {
      if (typeof component === "object") {
        this.NotComponents.push(component.Component);
      } else {
        this.Components.push(component);
      }
    });

    if (this.Components.length === 0) {
      throw new Error("Can't create a query without components");
    }

    this.entities = [];

    this.eventDispatcher = new EventDispatcher();

    // This query is being used by a reactive system
    this.reactive = false;

    this.key = queryKey(Components);

    // Fill the query with the existing entities
    for (var i = 0; i < manager._entities.length; i++) {
      var entity = manager._entities[i];
      if (this.match(entity)) {
        // @todo ??? this.addEntity(entity); => preventing the event to be generated
        entity.queries.push(this);
        this.entities.push(entity);
      }
    }
  }

  /**
   * Add entity to this query
   * @param {Entity} entity
   */
  addEntity(entity) {
    entity.queries.push(this);
    this.entities.push(entity);

    this.eventDispatcher.dispatchEvent(Query.prototype.ENTITY_ADDED, entity);
  }

  /**
   * Remove entity from this query
   * @param {Entity} entity
   */
  removeEntity(entity) {
    let index = this.entities.indexOf(entity);
    if (~index) {
      this.entities.splice(index, 1);

      index = entity.queries.indexOf(this);
      entity.queries.splice(index, 1);

      this.eventDispatcher.dispatchEvent(
        Query.prototype.ENTITY_REMOVED,
        entity
      );
    }
  }

  match(entity) {
    return (
      entity.hasAllComponents(this.Components) &&
      !entity.hasAnyComponents(this.NotComponents)
    );
  }

  toJSON() {
    return {
      key: this.key,
      reactive: this.reactive,
      components: {
        included: this.Components.map(C => C.name),
        not: this.NotComponents.map(C => C.name)
      },
      numEntities: this.entities.length
    };
  }

  /**
   * Return stats for this query
   */
  stats() {
    return {
      numComponents: this.Components.length,
      numEntities: this.entities.length
    };
  }
}

Query.prototype.ENTITY_ADDED = "Query#ENTITY_ADDED";
Query.prototype.ENTITY_REMOVED = "Query#ENTITY_REMOVED";
Query.prototype.COMPONENT_CHANGED = "Query#COMPONENT_CHANGED";

class System {
  canExecute() {
    if (this._mandatoryQueries.length === 0) return true;

    for (let i = 0; i < this._mandatoryQueries.length; i++) {
      var query = this._mandatoryQueries[i];
      if (query.entities.length === 0) {
        return false;
      }
    }

    return true;
  }

  constructor(world, attributes) {
    this.world = world;
    this.enabled = true;

    // @todo Better naming :)
    this._queries = {};
    this.queries = {};

    this.priority = 0;

    // Used for stats
    this.executeTime = 0;

    if (attributes && attributes.priority) {
      this.priority = attributes.priority;
    }

    this._mandatoryQueries = [];

    this.initialized = true;

    if (this.constructor.queries) {
      for (var queryName in this.constructor.queries) {
        var queryConfig = this.constructor.queries[queryName];
        var Components = queryConfig.components;
        if (!Components || Components.length === 0) {
          throw new Error("'components' attribute can't be empty in a query");
        }
        var query = this.world.entityManager.queryComponents(Components);
        this._queries[queryName] = query;
        if (queryConfig.mandatory === true) {
          this._mandatoryQueries.push(query);
        }
        this.queries[queryName] = {
          results: query.entities
        };

        // Reactive configuration added/removed/changed
        var validEvents = ["added", "removed", "changed"];

        const eventMapping = {
          added: Query.prototype.ENTITY_ADDED,
          removed: Query.prototype.ENTITY_REMOVED,
          changed: Query.prototype.COMPONENT_CHANGED // Query.prototype.ENTITY_CHANGED
        };

        if (queryConfig.listen) {
          validEvents.forEach(eventName => {
            if (!this.execute) {
              console.warn(
                `System '${
                  this.constructor.name
                }' has defined listen events (${validEvents.join(
                  ", "
                )}) for query '${queryName}' but it does not implement the 'execute' method.`
              );
            }

            // Is the event enabled on this system's query?
            if (queryConfig.listen[eventName]) {
              let event = queryConfig.listen[eventName];

              if (eventName === "changed") {
                query.reactive = true;
                if (event === true) {
                  // Any change on the entity from the components in the query
                  let eventList = (this.queries[queryName][eventName] = []);
                  query.eventDispatcher.addEventListener(
                    Query.prototype.COMPONENT_CHANGED,
                    entity => {
                      // Avoid duplicates
                      if (eventList.indexOf(entity) === -1) {
                        eventList.push(entity);
                      }
                    }
                  );
                } else if (Array.isArray(event)) {
                  let eventList = (this.queries[queryName][eventName] = []);
                  query.eventDispatcher.addEventListener(
                    Query.prototype.COMPONENT_CHANGED,
                    (entity, changedComponent) => {
                      // Avoid duplicates
                      if (
                        event.indexOf(changedComponent.constructor) !== -1 &&
                        eventList.indexOf(entity) === -1
                      ) {
                        eventList.push(entity);
                      }
                    }
                  );
                }
              } else {
                let eventList = (this.queries[queryName][eventName] = []);

                query.eventDispatcher.addEventListener(
                  eventMapping[eventName],
                  entity => {
                    // @fixme overhead?
                    if (eventList.indexOf(entity) === -1)
                      eventList.push(entity);
                  }
                );
              }
            }
          });
        }
      }
    }
  }

  stop() {
    this.executeTime = 0;
    this.enabled = false;
  }

  play() {
    this.enabled = true;
  }

  // @question rename to clear queues?
  clearEvents() {
    for (let queryName in this.queries) {
      var query = this.queries[queryName];
      if (query.added) {
        query.added.length = 0;
      }
      if (query.removed) {
        query.removed.length = 0;
      }
      if (query.changed) {
        if (Array.isArray(query.changed)) {
          query.changed.length = 0;
        } else {
          for (let name in query.changed) {
            query.changed[name].length = 0;
          }
        }
      }
    }
  }

  toJSON() {
    var json = {
      name: this.constructor.name,
      enabled: this.enabled,
      executeTime: this.executeTime,
      priority: this.priority,
      queries: {}
    };

    if (this.constructor.queries) {
      var queries = this.constructor.queries;
      for (let queryName in queries) {
        let query = this.queries[queryName];
        let queryDefinition = queries[queryName];
        let jsonQuery = (json.queries[queryName] = {
          key: this._queries[queryName].key
        });

        jsonQuery.mandatory = queryDefinition.mandatory === true;
        jsonQuery.reactive =
          queryDefinition.listen &&
          (queryDefinition.listen.added === true ||
            queryDefinition.listen.removed === true ||
            queryDefinition.listen.changed === true ||
            Array.isArray(queryDefinition.listen.changed));

        if (jsonQuery.reactive) {
          jsonQuery.listen = {};

          const methods = ["added", "removed", "changed"];
          methods.forEach(method => {
            if (query[method]) {
              jsonQuery.listen[method] = {
                entities: query[method].length
              };
            }
          });
        }
      }
    }

    return json;
  }
}

class SystemManager {
  constructor(world) {
    this._systems = [];
    this._executeSystems = []; // Systems that have `execute` method
    this.world = world;
    this.lastExecutedSystem = null;
  }

  registerSystem(SystemClass, attributes) {
    if (!(SystemClass.prototype instanceof System)) {
      throw new Error(
        `System '${SystemClass.name}' does not extends 'System' class`
      );
    }
    if (this.getSystem(SystemClass) !== undefined) {
      console.warn(`System '${SystemClass.name}' already registered.`);
      return this;
    }

    var system = new SystemClass(this.world, attributes);
    if (system.init) system.init(attributes);
    system.order = this._systems.length;
    this._systems.push(system);
    if (system.execute) {
      this._executeSystems.push(system);
      this.sortSystems();
    }
    return this;
  }

  unregisterSystem(SystemClass) {
    let system = this.getSystem(SystemClass);
    if (system === undefined) {
      console.warn(
        `Can unregister system '${SystemClass.name}'. It doesn't exist.`
      );
      return this;
    }

    this._systems.splice(this._systems.indexOf(system), 1);

    if (system.execute) {
      this._executeSystems.splice(this._executeSystems.indexOf(system), 1);
    }

    // @todo Add system.unregister() call to free resources
    return this;
  }

  sortSystems() {
    this._executeSystems.sort((a, b) => {
      return a.priority - b.priority || a.order - b.order;
    });
  }

  getSystem(SystemClass) {
    return this._systems.find(s => s instanceof SystemClass);
  }

  getSystems() {
    return this._systems;
  }

  removeSystem(SystemClass) {
    var index = this._systems.indexOf(SystemClass);
    if (!~index) return;

    this._systems.splice(index, 1);
  }

  executeSystem(system, delta, time) {
    if (system.initialized) {
      if (system.canExecute()) {
        let startTime = now();
        system.execute(delta, time);
        system.executeTime = now() - startTime;
        this.lastExecutedSystem = system;
        system.clearEvents();
      }
    }
  }

  stop() {
    this._executeSystems.forEach(system => system.stop());
  }

  execute(delta, time, forcePlay) {
    this._executeSystems.forEach(
      system =>
        (forcePlay || system.enabled) && this.executeSystem(system, delta, time)
    );
  }

  stats() {
    var stats = {
      numSystems: this._systems.length,
      systems: {}
    };

    for (var i = 0; i < this._systems.length; i++) {
      var system = this._systems[i];
      var systemStats = (stats.systems[system.constructor.name] = {
        queries: {},
        executeTime: system.executeTime
      });
      for (var name in system.ctx) {
        systemStats.queries[name] = system.ctx[name].stats();
      }
    }

    return stats;
  }
}

class ObjectPool {
  // @todo Add initial size
  constructor(T, initialSize) {
    this.freeList = [];
    this.count = 0;
    this.T = T;
    this.isObjectPool = true;

    var extraArgs = null;
    if (arguments.length > 1) {
      extraArgs = Array.prototype.slice.call(arguments);
      extraArgs.shift();
    }

    this.createElement = extraArgs
      ? () => {
          return new T(...extraArgs);
        }
      : () => {
          return new T();
        };

    if (typeof initialSize !== "undefined") {
      this.expand(initialSize);
    }
  }

  acquire() {
    // Grow the list by 20%ish if we're out
    if (this.freeList.length <= 0) {
      this.expand(Math.round(this.count * 0.2) + 1);
    }

    var item = this.freeList.pop();

    return item;
  }

  release(item) {
    item.reset();
    this.freeList.push(item);
  }

  expand(count) {
    for (var n = 0; n < count; n++) {
      this.freeList.push(this.createElement());
    }
    this.count += count;
  }

  totalSize() {
    return this.count;
  }

  totalFree() {
    return this.freeList.length;
  }

  totalUsed() {
    return this.count - this.freeList.length;
  }
}

/**
 * @private
 * @class QueryManager
 */
class QueryManager {
  constructor(world) {
    this._world = world;

    // Queries indexed by a unique identifier for the components it has
    this._queries = {};
  }

  onEntityRemoved(entity) {
    for (var queryName in this._queries) {
      var query = this._queries[queryName];
      if (entity.queries.indexOf(query) !== -1) {
        query.removeEntity(entity);
      }
    }
  }

  /**
   * Callback when a component is added to an entity
   * @param {Entity} entity Entity that just got the new component
   * @param {Component} Component Component added to the entity
   */
  onEntityComponentAdded(entity, Component) {
    // @todo Use bitmask for checking components?

    // Check each indexed query to see if we need to add this entity to the list
    for (var queryName in this._queries) {
      var query = this._queries[queryName];

      if (
        !!~query.NotComponents.indexOf(Component) &&
        ~query.entities.indexOf(entity)
      ) {
        query.removeEntity(entity);
        continue;
      }

      // Add the entity only if:
      // Component is in the query
      // and Entity has ALL the components of the query
      // and Entity is not already in the query
      if (
        !~query.Components.indexOf(Component) ||
        !query.match(entity) ||
        ~query.entities.indexOf(entity)
      )
        continue;

      query.addEntity(entity);
    }
  }

  /**
   * Callback when a component is removed from an entity
   * @param {Entity} entity Entity to remove the component from
   * @param {Component} Component Component to remove from the entity
   */
  onEntityComponentRemoved(entity, Component) {
    for (var queryName in this._queries) {
      var query = this._queries[queryName];

      if (
        !!~query.NotComponents.indexOf(Component) &&
        !~query.entities.indexOf(entity) &&
        query.match(entity)
      ) {
        query.addEntity(entity);
        continue;
      }

      if (
        !!~query.Components.indexOf(Component) &&
        !!~query.entities.indexOf(entity) &&
        !query.match(entity)
      ) {
        query.removeEntity(entity);
        continue;
      }
    }
  }

  /**
   * Get a query for the specified components
   * @param {Component} Components Components that the query should have
   */
  getQuery(Components) {
    var key = queryKey(Components);
    var query = this._queries[key];
    if (!query) {
      this._queries[key] = query = new Query(Components, this._world);
    }
    return query;
  }

  /**
   * Return some stats from this class
   */
  stats() {
    var stats = {};
    for (var queryName in this._queries) {
      stats[queryName] = this._queries[queryName].stats();
    }
    return stats;
  }
}

class SystemStateComponent {}

SystemStateComponent.isSystemStateComponent = true;

/**
 * @private
 * @class EntityManager
 */
class EntityManager {
  constructor(world) {
    this.world = world;
    this.componentsManager = world.componentsManager;

    // All the entities in this instance
    this._entities = [];

    this._entitiesByNames = {};

    this._queryManager = new QueryManager(this);
    this.eventDispatcher = new EventDispatcher();
    this._entityPool = new ObjectPool(
      this.world.options.entityClass,
      this.world.options.entityPoolSize
    );

    // Deferred deletion
    this.entitiesWithComponentsToRemove = [];
    this.entitiesToRemove = [];
    this.deferredRemovalEnabled = true;
  }

  getEntityByName(name) {
    return this._entitiesByNames[name];
  }

  /**
   * Create a new entity
   */
  createEntity(name) {
    var entity = this._entityPool.acquire();
    entity.alive = true;
    entity.name = name || "";
    if (name) {
      if (this._entitiesByNames[name]) {
        console.warn(`Entity name '${name}' already exist`);
      } else {
        this._entitiesByNames[name] = entity;
      }
    }

    entity._world = this;
    this._entities.push(entity);
    this.eventDispatcher.dispatchEvent(ENTITY_CREATED, entity);
    return entity;
  }

  // COMPONENTS

  /**
   * Add a component to an entity
   * @param {Entity} entity Entity where the component will be added
   * @param {Component} Component Component to be added to the entity
   * @param {Object} values Optional values to replace the default attributes
   */
  entityAddComponent(entity, Component, values) {
    if (~entity._ComponentTypes.indexOf(Component)) {
      // @todo Just on debug mode
      console.warn(
        "Component type already exists on entity.",
        entity,
        Component.name
      );
      return;
    }

    entity._ComponentTypes.push(Component);

    if (Component.__proto__ === SystemStateComponent) {
      entity.numStateComponents++;
    }

    var componentPool = this.world.componentsManager.getComponentsPool(
      Component
    );
    var component = componentPool.acquire();

    entity._components[Component.name] = component;

    if (values) {
      if (component.copy) {
        component.copy(values);
      } else {
        for (var name in values) {
          component[name] = values[name];
        }
      }
    }

    this._queryManager.onEntityComponentAdded(entity, Component);
    this.world.componentsManager.componentAddedToEntity(Component);

    this.eventDispatcher.dispatchEvent(COMPONENT_ADDED, entity, Component);
  }

  /**
   * Remove a component from an entity
   * @param {Entity} entity Entity which will get removed the component
   * @param {*} Component Component to remove from the entity
   * @param {Bool} immediately If you want to remove the component immediately instead of deferred (Default is false)
   */
  entityRemoveComponent(entity, Component, immediately) {
    var index = entity._ComponentTypes.indexOf(Component);
    if (!~index) return;

    this.eventDispatcher.dispatchEvent(COMPONENT_REMOVE, entity, Component);

    if (immediately) {
      this._entityRemoveComponentSync(entity, Component, index);
    } else {
      if (entity._ComponentTypesToRemove.length === 0)
        this.entitiesWithComponentsToRemove.push(entity);

      entity._ComponentTypes.splice(index, 1);
      entity._ComponentTypesToRemove.push(Component);

      var componentName = getName(Component);
      entity._componentsToRemove[componentName] =
        entity._components[componentName];
      delete entity._components[componentName];
    }

    // Check each indexed query to see if we need to remove it
    this._queryManager.onEntityComponentRemoved(entity, Component);

    if (Component.__proto__ === SystemStateComponent) {
      entity.numStateComponents--;

      // Check if the entity was a ghost waiting for the last system state component to be removed
      if (entity.numStateComponents === 0 && !entity.alive) {
        entity.remove();
      }
    }
  }

  _entityRemoveComponentSync(entity, Component, index) {
    // Remove T listing on entity and property ref, then free the component.
    entity._ComponentTypes.splice(index, 1);
    var propName = componentPropertyName(Component);
    var componentName = getName(Component);
    var component = entity._components[componentName];
    delete entity._components[componentName];
    this.componentsManager._componentPool[propName].release(component);
    this.world.componentsManager.componentRemovedFromEntity(Component);
  }

  /**
   * Remove all the components from an entity
   * @param {Entity} entity Entity from which the components will be removed
   */
  entityRemoveAllComponents(entity, immediately) {
    let Components = entity._ComponentTypes;

    for (let j = Components.length - 1; j >= 0; j--) {
      if (Components[j].__proto__ !== SystemStateComponent)
        this.entityRemoveComponent(entity, Components[j], immediately);
    }
  }

  /**
   * Remove the entity from this manager. It will clear also its components
   * @param {Entity} entity Entity to remove from the manager
   * @param {Bool} immediately If you want to remove the component immediately instead of deferred (Default is false)
   */
  removeEntity(entity, immediately) {
    var index = this._entities.indexOf(entity);

    if (!~index) throw new Error("Tried to remove entity not in list");

    entity.alive = false;

    if (entity.numStateComponents === 0) {
      // Remove from entity list
      this.eventDispatcher.dispatchEvent(ENTITY_REMOVED, entity);
      this._queryManager.onEntityRemoved(entity);
      if (immediately === true) {
        this._releaseEntity(entity, index);
      } else {
        this.entitiesToRemove.push(entity);
      }
    }

    this.entityRemoveAllComponents(entity, immediately);
  }

  _releaseEntity(entity, index) {
    this._entities.splice(index, 1);

    if (this._entitiesByNames[entity.name]) {
      delete this._entitiesByNames[entity.name];
    }

    // Prevent any access and free
    entity._world = null;
    this._entityPool.release(entity);
  }

  /**
   * Remove all entities from this manager
   */
  removeAllEntities() {
    for (var i = this._entities.length - 1; i >= 0; i--) {
      this.removeEntity(this._entities[i]);
    }
  }

  processDeferredRemoval() {
    if (!this.deferredRemovalEnabled) {
      return;
    }

    for (let i = 0; i < this.entitiesToRemove.length; i++) {
      let entity = this.entitiesToRemove[i];
      let index = this._entities.indexOf(entity);
      this._releaseEntity(entity, index);
    }
    this.entitiesToRemove.length = 0;

    for (let i = 0; i < this.entitiesWithComponentsToRemove.length; i++) {
      let entity = this.entitiesWithComponentsToRemove[i];
      while (entity._ComponentTypesToRemove.length > 0) {
        let Component = entity._ComponentTypesToRemove.pop();

        var propName = componentPropertyName(Component);
        var componentName = getName(Component);
        var component = entity._componentsToRemove[componentName];
        delete entity._componentsToRemove[componentName];
        this.componentsManager._componentPool[propName].release(component);
        this.world.componentsManager.componentRemovedFromEntity(Component);

        //this._entityRemoveComponentSync(entity, Component, index);
      }
    }

    this.entitiesWithComponentsToRemove.length = 0;
  }

  /**
   * Get a query based on a list of components
   * @param {Array(Component)} Components List of components that will form the query
   */
  queryComponents(Components) {
    return this._queryManager.getQuery(Components);
  }

  // EXTRAS

  /**
   * Return number of entities
   */
  count() {
    return this._entities.length;
  }

  /**
   * Return some stats
   */
  stats() {
    var stats = {
      numEntities: this._entities.length,
      numQueries: Object.keys(this._queryManager._queries).length,
      queries: this._queryManager.stats(),
      numComponentPool: Object.keys(this.componentsManager._componentPool)
        .length,
      componentPool: {},
      eventDispatcher: this.eventDispatcher.stats
    };

    for (var cname in this.componentsManager._componentPool) {
      var pool = this.componentsManager._componentPool[cname];
      stats.componentPool[cname] = {
        used: pool.totalUsed(),
        size: pool.count
      };
    }

    return stats;
  }
}

const ENTITY_CREATED = "EntityManager#ENTITY_CREATE";
const ENTITY_REMOVED = "EntityManager#ENTITY_REMOVED";
const COMPONENT_ADDED = "EntityManager#COMPONENT_ADDED";
const COMPONENT_REMOVE = "EntityManager#COMPONENT_REMOVE";

class DummyObjectPool {
  constructor(T) {
    this.isDummyObjectPool = true;
    this.count = 0;
    this.used = 0;
    this.T = T;
  }

  acquire() {
    this.used++;
    this.count++;
    return new this.T();
  }

  release() {
    this.used--;
  }

  totalSize() {
    return this.count;
  }

  totalFree() {
    return Infinity;
  }

  totalUsed() {
    return this.used;
  }
}

class ComponentManager {
  constructor() {
    this.Components = {};
    this._componentPool = {};
    this.numComponents = {};
  }

  registerComponent(Component) {
    if (this.Components[Component.name]) {
      console.warn(`Component type: '${Component.name}' already registered.`);
      return;
    }

    this.Components[Component.name] = Component;
    this.numComponents[Component.name] = 0;
  }

  componentAddedToEntity(Component) {
    if (!this.Components[Component.name]) {
      this.registerComponent(Component);
    }

    this.numComponents[Component.name]++;
  }

  componentRemovedFromEntity(Component) {
    this.numComponents[Component.name]--;
  }

  getComponentsPool(Component) {
    var componentName = componentPropertyName(Component);

    if (!this._componentPool[componentName]) {
      if (Component.prototype.reset) {
        this._componentPool[componentName] = new ObjectPool(Component);
      } else {
        console.warn(
          `Component '${Component.name}' won't benefit from pooling because 'reset' method was not implemented.`
        );
        this._componentPool[componentName] = new DummyObjectPool(Component);
      }
    }

    return this._componentPool[componentName];
  }
}

var name = "test-ecsy-build";
var version = "0.2.8";
var description = "Entity Component System in JS";
var main = "lib/index.js";
var module = "src/index.js";
var types = "src/index.d.ts";
var scripts = {
	build: "rollup -c && npm run docs && npm run build:cjs",
	"build:cjs": "rimraf lib && babel src -d lib",
	docs: "cp README.md site/docs/README.md && rimraf site/docs/api/_sidebar.md; typedoc --readme none --mode file --excludeExternals --plugin typedoc-plugin-markdown  --theme site/docs/theme --hideSources --hideBreadcrumbs --out site/docs/api/ --includeDeclarations --includes 'src/**/*.d.ts' src; touch site/docs/api/_sidebar.md",
	"dev:docs": "nodemon -e ts -x 'npm run docs' -w src",
	dev: "concurrently --names 'ROLLUP,DOCS,HTTP' -c 'bgBlue.bold,bgYellow.bold,bgGreen.bold' 'rollup -c -w -m inline' 'npm run dev:docs' 'npm run dev:server'",
	"dev:server": "http-server -c-1 -p 8080 --cors ./site",
	lint: "eslint src test examples",
	start: "npm run dev",
	deploy: "np",
	postdeploy: "npm run gh-pages",
	"gh-pages": "gh-pages -d site",
	benchmarks: "node -r esm --expose-gc benchmarks/index.js",
	test: "ava",
	travis: "npm run lint && npm run test && npm run build",
	"watch:test": "ava --watch"
};
var repository = {
	type: "git",
	url: "git+https://github.com/robertlong/ecsy.git"
};
var keywords = [
	"ecs",
	"entity component system"
];
var author = "Mozilla Reality <mr-internal@mozilla.com> (https://mixedreality.mozilla.org)";
var license = "MIT";
var bugs = {
	url: "https://github.com/robertlong/ecsy/issues"
};
var ava = {
	files: [
		"test/**/*.test.js"
	],
	require: [
		"esm"
	]
};
var files = [
	"build",
	"lib",
	"src"
];
var homepage = "https://github.com/robertlong/ecsy#readme";
var devDependencies = {
	"@babel/cli": "^7.10.1",
	"@babel/core": "^7.10.2",
	"@babel/plugin-transform-modules-commonjs": "^7.10.1",
	"@rollup/plugin-node-resolve": "^8.0.1",
	ava: "^3.9.0",
	"babel-eslint": "^10.0.3",
	"benchmarker-js": "0.0.1",
	concurrently: "^4.1.2",
	"docsify-cli": "^4.4.0",
	eslint: "^5.16.0",
	"eslint-config-prettier": "^4.3.0",
	"eslint-plugin-prettier": "^3.1.2",
	esm: "^3.2.25",
	"gh-pages": "^3.0.0",
	"http-server": "^0.11.1",
	nodemon: "^1.19.4",
	np: "^6.2.4",
	prettier: "^1.19.1",
	rimraf: "^3.0.2",
	rollup: "^1.29.0",
	"rollup-plugin-json": "^4.0.0",
	"rollup-plugin-sourcemaps": "^0.6.2",
	"rollup-plugin-terser": "^5.2.0",
	typedoc: "^0.15.8",
	"typedoc-plugin-markdown": "^2.2.16",
	typescript: "^3.7.5"
};
var pjson = {
	name: name,
	version: version,
	description: description,
	main: main,
	module: module,
	types: types,
	scripts: scripts,
	repository: repository,
	keywords: keywords,
	author: author,
	license: license,
	bugs: bugs,
	ava: ava,
	files: files,
	homepage: homepage,
	devDependencies: devDependencies
};

const Version = pjson.version;

var nextId = 0;

class Entity {
  constructor(world) {
    this._world = world || null;

    // Unique ID for this entity
    this.id = nextId++;

    // List of components types the entity has
    this._ComponentTypes = [];

    // Instance of the components
    this._components = {};

    this._componentsToRemove = {};

    // Queries where the entity is added
    this.queries = [];

    // Used for deferred removal
    this._ComponentTypesToRemove = [];

    this.alive = false;

    //if there are state components on a entity, it can't be removed completely
    this.numStateComponents = 0;
  }

  // COMPONENTS

  getComponent(Component, includeRemoved) {
    var component = this._components[Component.name];

    if (!component && includeRemoved === true) {
      component = this._componentsToRemove[Component.name];
    }

    return  component;
  }

  getRemovedComponent(Component) {
    return this._componentsToRemove[Component.name];
  }

  getComponents() {
    return this._components;
  }

  getComponentsToRemove() {
    return this._componentsToRemove;
  }

  getComponentTypes() {
    return this._ComponentTypes;
  }

  getMutableComponent(Component) {
    var component = this._components[Component.name];
    for (var i = 0; i < this.queries.length; i++) {
      var query = this.queries[i];
      // @todo accelerate this check. Maybe having query._Components as an object
      // @todo add Not components
      if (query.reactive && query.Components.indexOf(Component) !== -1) {
        query.eventDispatcher.dispatchEvent(
          Query.prototype.COMPONENT_CHANGED,
          this,
          component
        );
      }
    }
    return component;
  }

  addComponent(Component, values) {
    this._world.entityAddComponent(this, Component, values);
    return this;
  }

  removeComponent(Component, forceImmediate) {
    this._world.entityRemoveComponent(this, Component, forceImmediate);
    return this;
  }

  hasComponent(Component, includeRemoved) {
    return (
      !!~this._ComponentTypes.indexOf(Component) ||
      (includeRemoved === true && this.hasRemovedComponent(Component))
    );
  }

  hasRemovedComponent(Component) {
    return !!~this._ComponentTypesToRemove.indexOf(Component);
  }

  hasAllComponents(Components) {
    for (var i = 0; i < Components.length; i++) {
      if (!this.hasComponent(Components[i])) return false;
    }
    return true;
  }

  hasAnyComponents(Components) {
    for (var i = 0; i < Components.length; i++) {
      if (this.hasComponent(Components[i])) return true;
    }
    return false;
  }

  removeAllComponents(forceImmediate) {
    return this._world.entityRemoveAllComponents(this, forceImmediate);
  }

  // EXTRAS

  // Initialize the entity. To be used when returning an entity to the pool
  reset() {
    this.id = nextId++;
    this._world = null;
    this._ComponentTypes.length = 0;
    this.queries.length = 0;
    this._components = {};
  }

  remove(forceImmediate) {
    return this._world.removeEntity(this, forceImmediate);
  }
}

const DEFAULT_OPTIONS$1 = {
  entityPoolSize: 0,
  entityClass: Entity
};

class World {
  constructor(options = {}) {
    this.options = Object.assign({}, DEFAULT_OPTIONS$1, options);

    this.componentsManager = new ComponentManager(this);
    this.entityManager = new EntityManager(this);
    this.systemManager = new SystemManager(this);

    this.enabled = true;

    this.eventQueues = {};

    if (hasWindow && typeof CustomEvent !== "undefined") {
      var event = new CustomEvent("ecsy-world-created", {
        detail: { world: this, version: Version }
      });
      window.dispatchEvent(event);
    }

    this.lastTime = now();
  }

  registerComponent(Component) {
    this.componentsManager.registerComponent(Component);
    return this;
  }

  registerSystem(System, attributes) {
    this.systemManager.registerSystem(System, attributes);
    return this;
  }

  unregisterSystem(System) {
    this.systemManager.unregisterSystem(System);
    return this;
  }

  getSystem(SystemClass) {
    return this.systemManager.getSystem(SystemClass);
  }

  getSystems() {
    return this.systemManager.getSystems();
  }

  execute(delta, time) {
    if (!delta) {
      time = now();
      delta = time - this.lastTime;
      this.lastTime = time;
    }

    if (this.enabled) {
      this.systemManager.execute(delta, time);
      this.entityManager.processDeferredRemoval();
    }
  }

  stop() {
    this.enabled = false;
  }

  play() {
    this.enabled = true;
  }

  createEntity(name) {
    return this.entityManager.createEntity(name);
  }

  stats() {
    var stats = {
      entities: this.entityManager.stats(),
      system: this.systemManager.stats()
    };

    console.log(JSON.stringify(stats, null, 2));
  }
}

class TagComponent {
  reset() {}
}

TagComponent.isTagComponent = true;

function createType(typeDefinition) {
  var mandatoryFunctions = [
    "create",
    "reset",
    "clear"
    /*"copy"*/
  ];

  var undefinedFunctions = mandatoryFunctions.filter(f => {
    return !typeDefinition[f];
  });

  if (undefinedFunctions.length > 0) {
    throw new Error(
      `createType expect type definition to implements the following functions: ${undefinedFunctions.join(
        ", "
      )}`
    );
  }

  typeDefinition.isType = true;
  return typeDefinition;
}

/**
 * Standard types
 */
var Types = {};

Types.Number = createType({
  baseType: Number,
  isSimpleType: true,
  create: defaultValue => {
    return typeof defaultValue !== "undefined" ? defaultValue : 0;
  },
  reset: (src, key, defaultValue) => {
    if (typeof defaultValue !== "undefined") {
      src[key] = defaultValue;
    } else {
      src[key] = 0;
    }
  },
  clear: (src, key) => {
    src[key] = 0;
  }
});

Types.Boolean = createType({
  baseType: Boolean,
  isSimpleType: true,
  create: defaultValue => {
    return typeof defaultValue !== "undefined" ? defaultValue : false;
  },
  reset: (src, key, defaultValue) => {
    if (typeof defaultValue !== "undefined") {
      src[key] = defaultValue;
    } else {
      src[key] = false;
    }
  },
  clear: (src, key) => {
    src[key] = false;
  }
});

Types.String = createType({
  baseType: String,
  isSimpleType: true,
  create: defaultValue => {
    return typeof defaultValue !== "undefined" ? defaultValue : "";
  },
  reset: (src, key, defaultValue) => {
    if (typeof defaultValue !== "undefined") {
      src[key] = defaultValue;
    } else {
      src[key] = "";
    }
  },
  clear: (src, key) => {
    src[key] = "";
  }
});

Types.Array = createType({
  baseType: Array,
  create: defaultValue => {
    if (typeof defaultValue !== "undefined") {
      return defaultValue.slice();
    }

    return [];
  },
  reset: (src, key, defaultValue) => {
    if (typeof defaultValue !== "undefined") {
      src[key] = defaultValue.slice();
    } else {
      src[key].length = 0;
    }
  },
  clear: (src, key) => {
    src[key].length = 0;
  },
  copy: (src, dst, key) => {
    src[key] = dst[key].slice();
  }
});

function generateId(length) {
  var result = "";
  var characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  var charactersLength = characters.length;
  for (var i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

function injectScript(src, onLoad) {
  var script = document.createElement("script");
  // @todo Use link to the ecsy-devtools repo?
  script.src = src;
  script.onload = onLoad;
  (document.head || document.documentElement).appendChild(script);
}

/* global Peer */

function hookConsoleAndErrors(connection) {
  var wrapFunctions = ["error", "warning", "log"];
  wrapFunctions.forEach(key => {
    if (typeof console[key] === "function") {
      var fn = console[key].bind(console);
      console[key] = (...args) => {
        connection.send({
          method: "console",
          type: key,
          args: JSON.stringify(args)
        });
        return fn.apply(null, args);
      };
    }
  });

  window.addEventListener("error", error => {
    connection.send({
      method: "error",
      error: JSON.stringify({
        message: error.error.message,
        stack: error.error.stack
      })
    });
  });
}

function includeRemoteIdHTML(remoteId) {
  let infoDiv = document.createElement("div");
  infoDiv.style.cssText = `
    align-items: center;
    background-color: #333;
    color: #aaa;
    display:flex;
    font-family: Arial;
    font-size: 1.1em;
    height: 40px;
    justify-content: center;
    left: 0;
    opacity: 0.9;
    position: absolute;
    right: 0;
    text-align: center;
    top: 0;
  `;

  infoDiv.innerHTML = `Open ECSY devtools to connect to this page using the code:&nbsp;<b style="color: #fff">${remoteId}</b>&nbsp;<button onClick="generateNewCode()">Generate new code</button>`;
  document.body.appendChild(infoDiv);

  return infoDiv;
}

function enableRemoteDevtools(remoteId) {
  if (!hasWindow) {
    console.warn("Remote devtools not available outside the browser");
    return;
  }

  window.generateNewCode = () => {
    window.localStorage.clear();
    remoteId = generateId(6);
    window.localStorage.setItem("ecsyRemoteId", remoteId);
    window.location.reload(false);
  };

  remoteId = remoteId || window.localStorage.getItem("ecsyRemoteId");
  if (!remoteId) {
    remoteId = generateId(6);
    window.localStorage.setItem("ecsyRemoteId", remoteId);
  }

  let infoDiv = includeRemoteIdHTML(remoteId);

  window.__ECSY_REMOTE_DEVTOOLS_INJECTED = true;
  window.__ECSY_REMOTE_DEVTOOLS = {};

  let Version = "";

  // This is used to collect the worlds created before the communication is being established
  let worldsBeforeLoading = [];
  let onWorldCreated = e => {
    var world = e.detail.world;
    Version = e.detail.version;
    worldsBeforeLoading.push(world);
  };
  window.addEventListener("ecsy-world-created", onWorldCreated);

  let onLoaded = () => {
    var peer = new Peer(remoteId);
    peer.on("open", (/* id */) => {
      peer.on("connection", connection => {
        window.__ECSY_REMOTE_DEVTOOLS.connection = connection;
        connection.on("open", function() {
          // infoDiv.style.visibility = "hidden";
          infoDiv.innerHTML = "Connected";

          // Receive messages
          connection.on("data", function(data) {
            if (data.type === "init") {
              var script = document.createElement("script");
              script.setAttribute("type", "text/javascript");
              script.onload = () => {
                script.parentNode.removeChild(script);

                // Once the script is injected we don't need to listen
                window.removeEventListener(
                  "ecsy-world-created",
                  onWorldCreated
                );
                worldsBeforeLoading.forEach(world => {
                  var event = new CustomEvent("ecsy-world-created", {
                    detail: { world: world, version: Version }
                  });
                  window.dispatchEvent(event);
                });
              };
              script.innerHTML = data.script;
              (document.head || document.documentElement).appendChild(script);
              script.onload();

              hookConsoleAndErrors(connection);
            } else if (data.type === "executeScript") {
              let value = eval(data.script);
              if (data.returnEval) {
                connection.send({
                  method: "evalReturn",
                  value: value
                });
              }
            }
          });
        });
      });
    });
  };

  // Inject PeerJS script
  injectScript(
    "https://cdn.jsdelivr.net/npm/peerjs@0.3.20/dist/peer.min.js",
    onLoaded
  );
}

if (hasWindow) {
  const urlParams = new URLSearchParams(window.location.search);

  // @todo Provide a way to disable it if needed
  if (urlParams.has("enable-remote-devtools")) {
    enableRemoteDevtools();
  }
}

class Vector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.set(x, y, z);
  }

  set(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
}

class TagComponentA extends TagComponent {}

class Component3 {
  constructor() {
    this.attr = 0;
    this.attr2 = 0;
    this.attr3 = new Vector3();
  }

  reset() {
    this.attr = 0;
    this.attr2 = "";
    this.attr3.set(0, 0, 0);
  }
}

function init(benchmarks) {
  benchmarks
    .group("world")
    .add({
      name: "new World({ entityPoolSize: 100k })",
      execute: () => {
        new World({ entityPoolSize: 100000 });
      },
      iterations: 10
    })
    .add({
      name: "World::createEntity (100k empty, recreating world)",
      execute: () => {
        let world = new World();
        for (let i = 0; i < 100000; i++) {
          world.createEntity();
        }
      },
      iterations: 10
    })
    .add({
      name:
        "World::createEntity (100k empty, recreating world (poolSize: 100k))",
      execute: () => {
        let world = new World({ entityPoolSize: 100000 });
        for (let i = 0; i < 100000; i++) {
          world.createEntity();
        }
      },
      iterations: 10
    })
    .add({
      name:
        "World::createEntity (100k empty, recreating world (not measured), entityPoolSize = 100k)",
      prepare: ctx => {
        ctx.world = new World({ entityPoolSize: 100000 });
      },
      execute: ctx => {
        for (let i = 0; i < 100000; i++) {
          ctx.world.createEntity();
        }
      },
      iterations: 10
    })
    .add({
      name:
        "World::createEntity(name) (100k empty, recreating world (not measured), entityPoolSize = 100k)",
      prepare: ctx => {
        ctx.world = new World({ entityPoolSize: 100000 });
      },
      execute: ctx => {
        for (let i = 0; i < 100000; i++) {
          ctx.world.createEntity("name" + i);
        }
      },
      iterations: 10
    })
    .add({
      name:
        "World::createEntity (100k empty, reuse world, entityPoolSize = 100k * 10)",
      prepareGlobal: ctx => {
        ctx.world = new World({ entityPoolSize: 100000 * 10 });
      },
      execute: ctx => {
        for (let i = 0; i < 100000; i++) {
          ctx.world.createEntity();
        }
      },
      iterations: 10
    });
}

function init$1(benchmarks) {
  benchmarks
    .group("objectpool")
    .add({
      name: "new ObjectPool(TagComponent, 100k)",
      execute: () => {
        new ObjectPool(TagComponentA, 100000);
      }
    })
    .add({
      name: "new ObjectPool(Component1, 100k)",
      execute: () => {
        new ObjectPool(Component3, 100000);
      }
    })
    .add({
      name: "acquiring 100k. ObjectPool(Component1, 100k)",
      prepare: ctx => {
        ctx.pool = new ObjectPool(Component3, 100000);
      },
      execute: ctx => {
        for (let i = 0; i < 100000; i++) {
          ctx.pool.acquire();
        }
      }
    })
    .add({
      name: "acquiring 100k. ObjectPool(Component1)",
      prepare: ctx => {
        ctx.pool = new ObjectPool(Component3);
      },
      execute: ctx => {
        for (let i = 0; i < 100000; i++) {
          ctx.pool.acquire();
        }
      }
    })
    .add({
      name: "returning 100k. ObjectPool(Component1)",
      prepare: ctx => {
        ctx.pool = new ObjectPool(Component3);
        ctx.components = [];
        for (let i = 0; i < 100000; i++) {
          ctx.components.push(ctx.pool.acquire());
        }
      },
      execute: ctx => {
        for (let i = 0; i < 100000; i++) {
          ctx.pool.release(ctx.components[i]);
        }
      }
    });
}

const div = document.getElementById("results");

let currentTable = null;
let currentGroup = null;

function onGroupStart(groupName) {
  var title = document.createElement("div");
  title.setAttribute("class", "table-title");
  title.innerHTML = `<h3>${groupName}</h3>`;
  div.appendChild(title);

  currentTable = document.createElement("table");
  currentTable.setAttribute("class", "table-fill");

  let headCells = [
    "benchmark",
    "iterations",
    "min",
    "max",
    "sum",
    "mean",
    "variance",
    "std_deviation"
  ]
    .map(name => `<th>${name}</th>`)
    .join("");

  currentTable.innerHTML = `<thead>
  <tr>
    ${headCells}
  </tr>
  </thead><tbody></tbody>`;
  div.appendChild(currentTable);

  currentGroup = groupName;
}

function onBenchmarkFinished(bench) {
  if (currentGroup !== bench.groupName) {
    onGroupStart(bench.groupName);
  }

  const values = bench.stats.getAll();

  const tbody = currentTable.querySelector("tbody");

  let rowHtml = `<td>${bench.name}</td><td>${bench.iterations}</td>`;

  const toFixed = ["mean", "variance", "standard_deviation"];
  Object.entries(values).forEach(([key, value]) => {
    if (key !== "n") {
      if (toFixed.indexOf(key) !== -1) {
        value = value.toFixed(2);
      }
      rowHtml += `<td>${value}</td>`;
    }
  });

  let row = document.createElement("tr");
  row.innerHTML = rowHtml;
  tbody.appendChild(row);
}

let benchmarks = new Benchmarks({
  //  verbose: true,
  summary: true,
  iterations: 10,
  onBenchmarkFinished: onBenchmarkFinished
});

init(benchmarks);
//initEntities(benchmarks);
init$1(benchmarks);
//initComponents(benchmarks);
benchmarks.run();

console.log(benchmarks.getReport("json"));
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmVuY2htYXJrcy5tb2R1bGUuanMiLCJzb3VyY2VzIjpbIi4uLy4uL25vZGVfbW9kdWxlcy9pbmNyZW1lbnRhbC1zdGF0cy1saXRlL2luZGV4LmpzIiwiLi4vLi4vbm9kZV9tb2R1bGVzL2JlbmNobWFya2VyLWpzL2luZGV4LmpzIiwiLi4vLi4vc3JjL1V0aWxzLmpzIiwiLi4vLi4vc3JjL0V2ZW50RGlzcGF0Y2hlci5qcyIsIi4uLy4uL3NyYy9RdWVyeS5qcyIsIi4uLy4uL3NyYy9TeXN0ZW0uanMiLCIuLi8uLi9zcmMvU3lzdGVtTWFuYWdlci5qcyIsIi4uLy4uL3NyYy9PYmplY3RQb29sLmpzIiwiLi4vLi4vc3JjL1F1ZXJ5TWFuYWdlci5qcyIsIi4uLy4uL3NyYy9TeXN0ZW1TdGF0ZUNvbXBvbmVudC5qcyIsIi4uLy4uL3NyYy9FbnRpdHlNYW5hZ2VyLmpzIiwiLi4vLi4vc3JjL0R1bW15T2JqZWN0UG9vbC5qcyIsIi4uLy4uL3NyYy9Db21wb25lbnRNYW5hZ2VyLmpzIiwiLi4vLi4vc3JjL1ZlcnNpb24uanMiLCIuLi8uLi9zcmMvRW50aXR5LmpzIiwiLi4vLi4vc3JjL1dvcmxkLmpzIiwiLi4vLi4vc3JjL1RhZ0NvbXBvbmVudC5qcyIsIi4uLy4uL3NyYy9DcmVhdGVUeXBlLmpzIiwiLi4vLi4vc3JjL1N0YW5kYXJkVHlwZXMuanMiLCIuLi8uLi9zcmMvUmVtb3RlRGV2VG9vbHMvdXRpbHMuanMiLCIuLi8uLi9zcmMvUmVtb3RlRGV2VG9vbHMvaW5kZXguanMiLCIuLi8uLi9iZW5jaG1hcmtzL2hlbHBlcnMvY29tcG9uZW50cy5qcyIsIi4uLy4uL2JlbmNobWFya3Mvd29ybGQuYmVuY2guanMiLCIuLi8uLi9iZW5jaG1hcmtzL29iamVjdHBvb2wuYmVuY2guanMiLCIuLi8uLi9iZW5jaG1hcmtzL2Jyb3dzZXIuanMiXSwic291cmNlc0NvbnRlbnQiOlsiJ3VzZSBzdHJpY3QnXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFBlcmZTdGF0cyB7XG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIHRoaXMubiA9IDA7XG4gICAgdGhpcy5taW4gPSBOdW1iZXIuTUFYX1ZBTFVFO1xuICAgIHRoaXMubWF4ID0gLU51bWJlci5NQVhfVkFMVUU7XG4gICAgdGhpcy5zdW0gPSAwO1xuICAgIHRoaXMubWVhbiA9IDA7XG4gICAgdGhpcy5xID0gMDtcbiAgfVxuXG4gIGdldCB2YXJpYW5jZSgpIHtcbiAgICByZXR1cm4gdGhpcy5xIC8gdGhpcy5uO1xuICB9XG5cbiAgZ2V0IHN0YW5kYXJkX2RldmlhdGlvbigpIHtcbiAgICByZXR1cm4gTWF0aC5zcXJ0KHRoaXMucSAvIHRoaXMubik7XG4gIH1cblxuICB1cGRhdGUodmFsdWUpIHtcbiAgICB2YXIgbnVtID0gcGFyc2VGbG9hdCh2YWx1ZSk7XG4gICAgaWYgKGlzTmFOKG51bSkpIHtcbiAgICAgIC8vIFNvcnJ5LCBubyBOYU5zXG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMubisrO1xuICAgIHRoaXMubWluID0gTWF0aC5taW4odGhpcy5taW4sIG51bSk7XG4gICAgdGhpcy5tYXggPSBNYXRoLm1heCh0aGlzLm1heCwgbnVtKTtcbiAgICB0aGlzLnN1bSArPSBudW07XG4gICAgY29uc3QgcHJldk1lYW4gPSB0aGlzLm1lYW47XG4gICAgdGhpcy5tZWFuID0gdGhpcy5tZWFuICsgKG51bSAtIHRoaXMubWVhbikgLyB0aGlzLm47XG4gICAgdGhpcy5xID0gdGhpcy5xICsgKG51bSAtIHByZXZNZWFuKSAqIChudW0gLSB0aGlzLm1lYW4pO1xuICB9XG5cbiAgZ2V0QWxsKCkge1xuICAgIHJldHVybiB7XG4gICAgICBuOiB0aGlzLm4sXG4gICAgICBtaW46IHRoaXMubWluLFxuICAgICAgbWF4OiB0aGlzLm1heCxcbiAgICAgIHN1bTogdGhpcy5zdW0sXG4gICAgICBtZWFuOiB0aGlzLm1lYW4sXG4gICAgICB2YXJpYW5jZTogdGhpcy52YXJpYW5jZSxcbiAgICAgIHN0YW5kYXJkX2RldmlhdGlvbjogdGhpcy5zdGFuZGFyZF9kZXZpYXRpb25cbiAgICB9O1xuICB9ICBcbn1cbiIsImltcG9ydCBTdGF0cyBmcm9tIFwiaW5jcmVtZW50YWwtc3RhdHMtbGl0ZVwiO1xuXG5jb25zdCBERUZBVUxUX0dMT0JBTF9PUFRJT05TID0ge1xuICB2ZXJib3NlOiBmYWxzZVxufTtcblxuY29uc3QgREVGQVVMVF9PUFRJT05TID0ge1xuICBnYzogdHJ1ZVxufTtcblxuZXhwb3J0IGNsYXNzIEJlbmNobWFya3Mge1xuICBjb25zdHJ1Y3RvcihnbG9iYWxPcHRpb25zLCBiZW5jaERlZmF1bHRPcHRpb25zKSB7XG4gICAgdGhpcy5iZW5jaHMgPSBbXTtcbiAgICB0aGlzLm9wdGlvbnMgPSBPYmplY3QuYXNzaWduKERFRkFVTFRfR0xPQkFMX09QVElPTlMsIGdsb2JhbE9wdGlvbnMpO1xuICAgIHRoaXMuYmVuY2hEZWZhdWx0T3B0aW9ucyA9IE9iamVjdC5hc3NpZ24oREVGQVVMVF9PUFRJT05TLCBiZW5jaERlZmF1bHRPcHRpb25zKTtcbiAgfVxuICBhZGQoYmVuY2gpIHtcbiAgICAvLyBvcHRpb25zID0ge31cbiAgICBpZiAoIWJlbmNoLm9wdGlvbnMpIHtcbiAgICAgIGJlbmNoLm9wdGlvbnMgPSB0aGlzLmJlbmNoRGVmYXVsdE9wdGlvbnM7XG4gICAgfSBlbHNlIHtcbiAgICAgIGJlbmNoLm9wdGlvbnMgPSBPYmplY3QuYXNzaWduKHRoaXMuYmVuY2hEZWZhdWx0T3B0aW9ucywgYmVuY2gub3B0aW9ucyk7XG4gICAgfVxuXG4gICAgdGhpcy5iZW5jaHMucHVzaChiZW5jaCk7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICBydW4oKSB7XG4gICAgdGhpcy5iZW5jaHMuZm9yRWFjaChiZW5jaCA9PiB7XG4gICAgICBsZXQgc3RhdHMgPSBuZXcgU3RhdHMoKTtcbiAgICAgIGxldCBjb250ZXh0ID0ge307XG4gICAgICBpZiAoYmVuY2gucHJlcGFyZUdsb2JhbCkge1xuICAgICAgICBiZW5jaC5wcmVwYXJlR2xvYmFsKGNvbnRleHQpO1xuICAgICAgfVxuXG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGJlbmNoLml0ZXJhdGlvbnM7IGkrKykge1xuICAgICAgICBpZiAoYmVuY2gucHJlcGFyZSkge1xuICAgICAgICAgIGJlbmNoLnByZXBhcmUoY29udGV4dCk7XG4gICAgICAgIH1cblxuICAgICAgICBsZXQgdDAgPSBEYXRlLm5vdygpO1xuICAgICAgICBiZW5jaC5leGVjdXRlKGNvbnRleHQpO1xuICAgICAgICBsZXQgdG90YWwgPSBEYXRlLm5vdygpIC0gdDA7XG4gICAgICAgIHN0YXRzLnVwZGF0ZSh0b3RhbCk7XG5cbiAgICAgICAgaWYgKGJlbmNoLm9wdGlvbnMuZ2MpIHtcbiAgICAgICAgICBnbG9iYWwuZ2MoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEB0b2RvIExvZ2dpbmcgb3B0aW9uc1xuICAgICAgICBpZiAodGhpcy5vcHRpb25zLnZlcmJvc2UpIHtcbiAgICAgICAgICBjb25zb2xlLmxvZyhcbiAgICAgICAgICAgIGAke2JlbmNoLm5hbWV9ICR7KGkgKyAxKS50b1N0cmluZygpLnBhZFN0YXJ0KDIpfS8ke1xuICAgICAgICAgICAgICBiZW5jaC5pdGVyYXRpb25zXG4gICAgICAgICAgICB9OiAke3RvdGFsfW1zYFxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKHRoaXMub3B0aW9ucy52ZXJib3NlKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKFxuICAgICAgICAgIGAke1wiPVwiLnJlcGVhdCg2MCl9XFxuJHtiZW5jaC5uYW1lfSAtICR7YmVuY2guaXRlcmF0aW9uc30gaXRlcmF0aW9uc2BcbiAgICAgICAgKTtcbiAgICAgICAgY29uc29sZS5sb2coXCItXCIucmVwZWF0KDYwKSk7XG4gICAgICAgIGNvbnNvbGUubG9nKHN0YXRzLmdldEFsbCgpKTtcbiAgICAgICAgY29uc29sZS5sb2coXCI9XCIucmVwZWF0KDYwKSk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cbn1cbiIsIi8qKlxuICogUmV0dXJuIHRoZSBuYW1lIG9mIGEgY29tcG9uZW50XG4gKiBAcGFyYW0ge0NvbXBvbmVudH0gQ29tcG9uZW50XG4gKiBAcHJpdmF0ZVxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2V0TmFtZShDb21wb25lbnQpIHtcbiAgcmV0dXJuIENvbXBvbmVudC5uYW1lO1xufVxuXG4vKipcbiAqIFJldHVybiBhIHZhbGlkIHByb3BlcnR5IG5hbWUgZm9yIHRoZSBDb21wb25lbnRcbiAqIEBwYXJhbSB7Q29tcG9uZW50fSBDb21wb25lbnRcbiAqIEBwcml2YXRlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb21wb25lbnRQcm9wZXJ0eU5hbWUoQ29tcG9uZW50KSB7XG4gIHJldHVybiBnZXROYW1lKENvbXBvbmVudCk7XG59XG5cbi8qKlxuICogR2V0IGEga2V5IGZyb20gYSBsaXN0IG9mIGNvbXBvbmVudHNcbiAqIEBwYXJhbSB7QXJyYXkoQ29tcG9uZW50KX0gQ29tcG9uZW50cyBBcnJheSBvZiBjb21wb25lbnRzIHRvIGdlbmVyYXRlIHRoZSBrZXlcbiAqIEBwcml2YXRlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBxdWVyeUtleShDb21wb25lbnRzKSB7XG4gIHZhciBuYW1lcyA9IFtdO1xuICBmb3IgKHZhciBuID0gMDsgbiA8IENvbXBvbmVudHMubGVuZ3RoOyBuKyspIHtcbiAgICB2YXIgVCA9IENvbXBvbmVudHNbbl07XG4gICAgaWYgKHR5cGVvZiBUID09PSBcIm9iamVjdFwiKSB7XG4gICAgICB2YXIgb3BlcmF0b3IgPSBULm9wZXJhdG9yID09PSBcIm5vdFwiID8gXCIhXCIgOiBULm9wZXJhdG9yO1xuICAgICAgbmFtZXMucHVzaChvcGVyYXRvciArIGdldE5hbWUoVC5Db21wb25lbnQpKTtcbiAgICB9IGVsc2Uge1xuICAgICAgbmFtZXMucHVzaChnZXROYW1lKFQpKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gbmFtZXMuc29ydCgpLmpvaW4oXCItXCIpO1xufVxuXG4vLyBEZXRlY3RvciBmb3IgYnJvd3NlcidzIFwid2luZG93XCJcbmV4cG9ydCBjb25zdCBoYXNXaW5kb3cgPSB0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiO1xuXG4vLyBwZXJmb3JtYW5jZS5ub3coKSBcInBvbHlmaWxsXCJcbmV4cG9ydCBjb25zdCBub3cgPVxuICBoYXNXaW5kb3cgJiYgdHlwZW9mIHdpbmRvdy5wZXJmb3JtYW5jZSAhPT0gXCJ1bmRlZmluZWRcIlxuICAgID8gcGVyZm9ybWFuY2Uubm93LmJpbmQocGVyZm9ybWFuY2UpXG4gICAgOiBEYXRlLm5vdy5iaW5kKERhdGUpO1xuIiwiLyoqXG4gKiBAcHJpdmF0ZVxuICogQGNsYXNzIEV2ZW50RGlzcGF0Y2hlclxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBFdmVudERpc3BhdGNoZXIge1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICB0aGlzLl9saXN0ZW5lcnMgPSB7fTtcbiAgICB0aGlzLnN0YXRzID0ge1xuICAgICAgZmlyZWQ6IDAsXG4gICAgICBoYW5kbGVkOiAwXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBZGQgYW4gZXZlbnQgbGlzdGVuZXJcbiAgICogQHBhcmFtIHtTdHJpbmd9IGV2ZW50TmFtZSBOYW1lIG9mIHRoZSBldmVudCB0byBsaXN0ZW5cbiAgICogQHBhcmFtIHtGdW5jdGlvbn0gbGlzdGVuZXIgQ2FsbGJhY2sgdG8gdHJpZ2dlciB3aGVuIHRoZSBldmVudCBpcyBmaXJlZFxuICAgKi9cbiAgYWRkRXZlbnRMaXN0ZW5lcihldmVudE5hbWUsIGxpc3RlbmVyKSB7XG4gICAgbGV0IGxpc3RlbmVycyA9IHRoaXMuX2xpc3RlbmVycztcbiAgICBpZiAobGlzdGVuZXJzW2V2ZW50TmFtZV0gPT09IHVuZGVmaW5lZCkge1xuICAgICAgbGlzdGVuZXJzW2V2ZW50TmFtZV0gPSBbXTtcbiAgICB9XG5cbiAgICBpZiAobGlzdGVuZXJzW2V2ZW50TmFtZV0uaW5kZXhPZihsaXN0ZW5lcikgPT09IC0xKSB7XG4gICAgICBsaXN0ZW5lcnNbZXZlbnROYW1lXS5wdXNoKGxpc3RlbmVyKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ2hlY2sgaWYgYW4gZXZlbnQgbGlzdGVuZXIgaXMgYWxyZWFkeSBhZGRlZCB0byB0aGUgbGlzdCBvZiBsaXN0ZW5lcnNcbiAgICogQHBhcmFtIHtTdHJpbmd9IGV2ZW50TmFtZSBOYW1lIG9mIHRoZSBldmVudCB0byBjaGVja1xuICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBsaXN0ZW5lciBDYWxsYmFjayBmb3IgdGhlIHNwZWNpZmllZCBldmVudFxuICAgKi9cbiAgaGFzRXZlbnRMaXN0ZW5lcihldmVudE5hbWUsIGxpc3RlbmVyKSB7XG4gICAgcmV0dXJuIChcbiAgICAgIHRoaXMuX2xpc3RlbmVyc1tldmVudE5hbWVdICE9PSB1bmRlZmluZWQgJiZcbiAgICAgIHRoaXMuX2xpc3RlbmVyc1tldmVudE5hbWVdLmluZGV4T2YobGlzdGVuZXIpICE9PSAtMVxuICAgICk7XG4gIH1cblxuICAvKipcbiAgICogUmVtb3ZlIGFuIGV2ZW50IGxpc3RlbmVyXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBldmVudE5hbWUgTmFtZSBvZiB0aGUgZXZlbnQgdG8gcmVtb3ZlXG4gICAqIEBwYXJhbSB7RnVuY3Rpb259IGxpc3RlbmVyIENhbGxiYWNrIGZvciB0aGUgc3BlY2lmaWVkIGV2ZW50XG4gICAqL1xuICByZW1vdmVFdmVudExpc3RlbmVyKGV2ZW50TmFtZSwgbGlzdGVuZXIpIHtcbiAgICB2YXIgbGlzdGVuZXJBcnJheSA9IHRoaXMuX2xpc3RlbmVyc1tldmVudE5hbWVdO1xuICAgIGlmIChsaXN0ZW5lckFycmF5ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHZhciBpbmRleCA9IGxpc3RlbmVyQXJyYXkuaW5kZXhPZihsaXN0ZW5lcik7XG4gICAgICBpZiAoaW5kZXggIT09IC0xKSB7XG4gICAgICAgIGxpc3RlbmVyQXJyYXkuc3BsaWNlKGluZGV4LCAxKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRGlzcGF0Y2ggYW4gZXZlbnRcbiAgICogQHBhcmFtIHtTdHJpbmd9IGV2ZW50TmFtZSBOYW1lIG9mIHRoZSBldmVudCB0byBkaXNwYXRjaFxuICAgKiBAcGFyYW0ge0VudGl0eX0gZW50aXR5IChPcHRpb25hbCkgRW50aXR5IHRvIGVtaXRcbiAgICogQHBhcmFtIHtDb21wb25lbnR9IGNvbXBvbmVudFxuICAgKi9cbiAgZGlzcGF0Y2hFdmVudChldmVudE5hbWUsIGVudGl0eSwgY29tcG9uZW50KSB7XG4gICAgdGhpcy5zdGF0cy5maXJlZCsrO1xuXG4gICAgdmFyIGxpc3RlbmVyQXJyYXkgPSB0aGlzLl9saXN0ZW5lcnNbZXZlbnROYW1lXTtcbiAgICBpZiAobGlzdGVuZXJBcnJheSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB2YXIgYXJyYXkgPSBsaXN0ZW5lckFycmF5LnNsaWNlKDApO1xuXG4gICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGFycmF5Lmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGFycmF5W2ldLmNhbGwodGhpcywgZW50aXR5LCBjb21wb25lbnQpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNldCBzdGF0cyBjb3VudGVyc1xuICAgKi9cbiAgcmVzZXRDb3VudGVycygpIHtcbiAgICB0aGlzLnN0YXRzLmZpcmVkID0gdGhpcy5zdGF0cy5oYW5kbGVkID0gMDtcbiAgfVxufVxuIiwiaW1wb3J0IEV2ZW50RGlzcGF0Y2hlciBmcm9tIFwiLi9FdmVudERpc3BhdGNoZXIuanNcIjtcbmltcG9ydCB7IHF1ZXJ5S2V5IH0gZnJvbSBcIi4vVXRpbHMuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgUXVlcnkge1xuICAvKipcbiAgICogQHBhcmFtIHtBcnJheShDb21wb25lbnQpfSBDb21wb25lbnRzIExpc3Qgb2YgdHlwZXMgb2YgY29tcG9uZW50cyB0byBxdWVyeVxuICAgKi9cbiAgY29uc3RydWN0b3IoQ29tcG9uZW50cywgbWFuYWdlcikge1xuICAgIHRoaXMuQ29tcG9uZW50cyA9IFtdO1xuICAgIHRoaXMuTm90Q29tcG9uZW50cyA9IFtdO1xuXG4gICAgQ29tcG9uZW50cy5mb3JFYWNoKGNvbXBvbmVudCA9PiB7XG4gICAgICBpZiAodHlwZW9mIGNvbXBvbmVudCA9PT0gXCJvYmplY3RcIikge1xuICAgICAgICB0aGlzLk5vdENvbXBvbmVudHMucHVzaChjb21wb25lbnQuQ29tcG9uZW50KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMuQ29tcG9uZW50cy5wdXNoKGNvbXBvbmVudCk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBpZiAodGhpcy5Db21wb25lbnRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ2FuJ3QgY3JlYXRlIGEgcXVlcnkgd2l0aG91dCBjb21wb25lbnRzXCIpO1xuICAgIH1cblxuICAgIHRoaXMuZW50aXRpZXMgPSBbXTtcblxuICAgIHRoaXMuZXZlbnREaXNwYXRjaGVyID0gbmV3IEV2ZW50RGlzcGF0Y2hlcigpO1xuXG4gICAgLy8gVGhpcyBxdWVyeSBpcyBiZWluZyB1c2VkIGJ5IGEgcmVhY3RpdmUgc3lzdGVtXG4gICAgdGhpcy5yZWFjdGl2ZSA9IGZhbHNlO1xuXG4gICAgdGhpcy5rZXkgPSBxdWVyeUtleShDb21wb25lbnRzKTtcblxuICAgIC8vIEZpbGwgdGhlIHF1ZXJ5IHdpdGggdGhlIGV4aXN0aW5nIGVudGl0aWVzXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBtYW5hZ2VyLl9lbnRpdGllcy5sZW5ndGg7IGkrKykge1xuICAgICAgdmFyIGVudGl0eSA9IG1hbmFnZXIuX2VudGl0aWVzW2ldO1xuICAgICAgaWYgKHRoaXMubWF0Y2goZW50aXR5KSkge1xuICAgICAgICAvLyBAdG9kbyA/Pz8gdGhpcy5hZGRFbnRpdHkoZW50aXR5KTsgPT4gcHJldmVudGluZyB0aGUgZXZlbnQgdG8gYmUgZ2VuZXJhdGVkXG4gICAgICAgIGVudGl0eS5xdWVyaWVzLnB1c2godGhpcyk7XG4gICAgICAgIHRoaXMuZW50aXRpZXMucHVzaChlbnRpdHkpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBZGQgZW50aXR5IHRvIHRoaXMgcXVlcnlcbiAgICogQHBhcmFtIHtFbnRpdHl9IGVudGl0eVxuICAgKi9cbiAgYWRkRW50aXR5KGVudGl0eSkge1xuICAgIGVudGl0eS5xdWVyaWVzLnB1c2godGhpcyk7XG4gICAgdGhpcy5lbnRpdGllcy5wdXNoKGVudGl0eSk7XG5cbiAgICB0aGlzLmV2ZW50RGlzcGF0Y2hlci5kaXNwYXRjaEV2ZW50KFF1ZXJ5LnByb3RvdHlwZS5FTlRJVFlfQURERUQsIGVudGl0eSk7XG4gIH1cblxuICAvKipcbiAgICogUmVtb3ZlIGVudGl0eSBmcm9tIHRoaXMgcXVlcnlcbiAgICogQHBhcmFtIHtFbnRpdHl9IGVudGl0eVxuICAgKi9cbiAgcmVtb3ZlRW50aXR5KGVudGl0eSkge1xuICAgIGxldCBpbmRleCA9IHRoaXMuZW50aXRpZXMuaW5kZXhPZihlbnRpdHkpO1xuICAgIGlmICh+aW5kZXgpIHtcbiAgICAgIHRoaXMuZW50aXRpZXMuc3BsaWNlKGluZGV4LCAxKTtcblxuICAgICAgaW5kZXggPSBlbnRpdHkucXVlcmllcy5pbmRleE9mKHRoaXMpO1xuICAgICAgZW50aXR5LnF1ZXJpZXMuc3BsaWNlKGluZGV4LCAxKTtcblxuICAgICAgdGhpcy5ldmVudERpc3BhdGNoZXIuZGlzcGF0Y2hFdmVudChcbiAgICAgICAgUXVlcnkucHJvdG90eXBlLkVOVElUWV9SRU1PVkVELFxuICAgICAgICBlbnRpdHlcbiAgICAgICk7XG4gICAgfVxuICB9XG5cbiAgbWF0Y2goZW50aXR5KSB7XG4gICAgcmV0dXJuIChcbiAgICAgIGVudGl0eS5oYXNBbGxDb21wb25lbnRzKHRoaXMuQ29tcG9uZW50cykgJiZcbiAgICAgICFlbnRpdHkuaGFzQW55Q29tcG9uZW50cyh0aGlzLk5vdENvbXBvbmVudHMpXG4gICAgKTtcbiAgfVxuXG4gIHRvSlNPTigpIHtcbiAgICByZXR1cm4ge1xuICAgICAga2V5OiB0aGlzLmtleSxcbiAgICAgIHJlYWN0aXZlOiB0aGlzLnJlYWN0aXZlLFxuICAgICAgY29tcG9uZW50czoge1xuICAgICAgICBpbmNsdWRlZDogdGhpcy5Db21wb25lbnRzLm1hcChDID0+IEMubmFtZSksXG4gICAgICAgIG5vdDogdGhpcy5Ob3RDb21wb25lbnRzLm1hcChDID0+IEMubmFtZSlcbiAgICAgIH0sXG4gICAgICBudW1FbnRpdGllczogdGhpcy5lbnRpdGllcy5sZW5ndGhcbiAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybiBzdGF0cyBmb3IgdGhpcyBxdWVyeVxuICAgKi9cbiAgc3RhdHMoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIG51bUNvbXBvbmVudHM6IHRoaXMuQ29tcG9uZW50cy5sZW5ndGgsXG4gICAgICBudW1FbnRpdGllczogdGhpcy5lbnRpdGllcy5sZW5ndGhcbiAgICB9O1xuICB9XG59XG5cblF1ZXJ5LnByb3RvdHlwZS5FTlRJVFlfQURERUQgPSBcIlF1ZXJ5I0VOVElUWV9BRERFRFwiO1xuUXVlcnkucHJvdG90eXBlLkVOVElUWV9SRU1PVkVEID0gXCJRdWVyeSNFTlRJVFlfUkVNT1ZFRFwiO1xuUXVlcnkucHJvdG90eXBlLkNPTVBPTkVOVF9DSEFOR0VEID0gXCJRdWVyeSNDT01QT05FTlRfQ0hBTkdFRFwiO1xuIiwiaW1wb3J0IFF1ZXJ5IGZyb20gXCIuL1F1ZXJ5LmpzXCI7XG5cbmV4cG9ydCBjbGFzcyBTeXN0ZW0ge1xuICBjYW5FeGVjdXRlKCkge1xuICAgIGlmICh0aGlzLl9tYW5kYXRvcnlRdWVyaWVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHRydWU7XG5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRoaXMuX21hbmRhdG9yeVF1ZXJpZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgIHZhciBxdWVyeSA9IHRoaXMuX21hbmRhdG9yeVF1ZXJpZXNbaV07XG4gICAgICBpZiAocXVlcnkuZW50aXRpZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIGNvbnN0cnVjdG9yKHdvcmxkLCBhdHRyaWJ1dGVzKSB7XG4gICAgdGhpcy53b3JsZCA9IHdvcmxkO1xuICAgIHRoaXMuZW5hYmxlZCA9IHRydWU7XG5cbiAgICAvLyBAdG9kbyBCZXR0ZXIgbmFtaW5nIDopXG4gICAgdGhpcy5fcXVlcmllcyA9IHt9O1xuICAgIHRoaXMucXVlcmllcyA9IHt9O1xuXG4gICAgdGhpcy5wcmlvcml0eSA9IDA7XG5cbiAgICAvLyBVc2VkIGZvciBzdGF0c1xuICAgIHRoaXMuZXhlY3V0ZVRpbWUgPSAwO1xuXG4gICAgaWYgKGF0dHJpYnV0ZXMgJiYgYXR0cmlidXRlcy5wcmlvcml0eSkge1xuICAgICAgdGhpcy5wcmlvcml0eSA9IGF0dHJpYnV0ZXMucHJpb3JpdHk7XG4gICAgfVxuXG4gICAgdGhpcy5fbWFuZGF0b3J5UXVlcmllcyA9IFtdO1xuXG4gICAgdGhpcy5pbml0aWFsaXplZCA9IHRydWU7XG5cbiAgICBpZiAodGhpcy5jb25zdHJ1Y3Rvci5xdWVyaWVzKSB7XG4gICAgICBmb3IgKHZhciBxdWVyeU5hbWUgaW4gdGhpcy5jb25zdHJ1Y3Rvci5xdWVyaWVzKSB7XG4gICAgICAgIHZhciBxdWVyeUNvbmZpZyA9IHRoaXMuY29uc3RydWN0b3IucXVlcmllc1txdWVyeU5hbWVdO1xuICAgICAgICB2YXIgQ29tcG9uZW50cyA9IHF1ZXJ5Q29uZmlnLmNvbXBvbmVudHM7XG4gICAgICAgIGlmICghQ29tcG9uZW50cyB8fCBDb21wb25lbnRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIidjb21wb25lbnRzJyBhdHRyaWJ1dGUgY2FuJ3QgYmUgZW1wdHkgaW4gYSBxdWVyeVwiKTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgcXVlcnkgPSB0aGlzLndvcmxkLmVudGl0eU1hbmFnZXIucXVlcnlDb21wb25lbnRzKENvbXBvbmVudHMpO1xuICAgICAgICB0aGlzLl9xdWVyaWVzW3F1ZXJ5TmFtZV0gPSBxdWVyeTtcbiAgICAgICAgaWYgKHF1ZXJ5Q29uZmlnLm1hbmRhdG9yeSA9PT0gdHJ1ZSkge1xuICAgICAgICAgIHRoaXMuX21hbmRhdG9yeVF1ZXJpZXMucHVzaChxdWVyeSk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5xdWVyaWVzW3F1ZXJ5TmFtZV0gPSB7XG4gICAgICAgICAgcmVzdWx0czogcXVlcnkuZW50aXRpZXNcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBSZWFjdGl2ZSBjb25maWd1cmF0aW9uIGFkZGVkL3JlbW92ZWQvY2hhbmdlZFxuICAgICAgICB2YXIgdmFsaWRFdmVudHMgPSBbXCJhZGRlZFwiLCBcInJlbW92ZWRcIiwgXCJjaGFuZ2VkXCJdO1xuXG4gICAgICAgIGNvbnN0IGV2ZW50TWFwcGluZyA9IHtcbiAgICAgICAgICBhZGRlZDogUXVlcnkucHJvdG90eXBlLkVOVElUWV9BRERFRCxcbiAgICAgICAgICByZW1vdmVkOiBRdWVyeS5wcm90b3R5cGUuRU5USVRZX1JFTU9WRUQsXG4gICAgICAgICAgY2hhbmdlZDogUXVlcnkucHJvdG90eXBlLkNPTVBPTkVOVF9DSEFOR0VEIC8vIFF1ZXJ5LnByb3RvdHlwZS5FTlRJVFlfQ0hBTkdFRFxuICAgICAgICB9O1xuXG4gICAgICAgIGlmIChxdWVyeUNvbmZpZy5saXN0ZW4pIHtcbiAgICAgICAgICB2YWxpZEV2ZW50cy5mb3JFYWNoKGV2ZW50TmFtZSA9PiB7XG4gICAgICAgICAgICBpZiAoIXRoaXMuZXhlY3V0ZSkge1xuICAgICAgICAgICAgICBjb25zb2xlLndhcm4oXG4gICAgICAgICAgICAgICAgYFN5c3RlbSAnJHtcbiAgICAgICAgICAgICAgICAgIHRoaXMuY29uc3RydWN0b3IubmFtZVxuICAgICAgICAgICAgICAgIH0nIGhhcyBkZWZpbmVkIGxpc3RlbiBldmVudHMgKCR7dmFsaWRFdmVudHMuam9pbihcbiAgICAgICAgICAgICAgICAgIFwiLCBcIlxuICAgICAgICAgICAgICAgICl9KSBmb3IgcXVlcnkgJyR7cXVlcnlOYW1lfScgYnV0IGl0IGRvZXMgbm90IGltcGxlbWVudCB0aGUgJ2V4ZWN1dGUnIG1ldGhvZC5gXG4gICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIElzIHRoZSBldmVudCBlbmFibGVkIG9uIHRoaXMgc3lzdGVtJ3MgcXVlcnk/XG4gICAgICAgICAgICBpZiAocXVlcnlDb25maWcubGlzdGVuW2V2ZW50TmFtZV0pIHtcbiAgICAgICAgICAgICAgbGV0IGV2ZW50ID0gcXVlcnlDb25maWcubGlzdGVuW2V2ZW50TmFtZV07XG5cbiAgICAgICAgICAgICAgaWYgKGV2ZW50TmFtZSA9PT0gXCJjaGFuZ2VkXCIpIHtcbiAgICAgICAgICAgICAgICBxdWVyeS5yZWFjdGl2ZSA9IHRydWU7XG4gICAgICAgICAgICAgICAgaWYgKGV2ZW50ID09PSB0cnVlKSB7XG4gICAgICAgICAgICAgICAgICAvLyBBbnkgY2hhbmdlIG9uIHRoZSBlbnRpdHkgZnJvbSB0aGUgY29tcG9uZW50cyBpbiB0aGUgcXVlcnlcbiAgICAgICAgICAgICAgICAgIGxldCBldmVudExpc3QgPSAodGhpcy5xdWVyaWVzW3F1ZXJ5TmFtZV1bZXZlbnROYW1lXSA9IFtdKTtcbiAgICAgICAgICAgICAgICAgIHF1ZXJ5LmV2ZW50RGlzcGF0Y2hlci5hZGRFdmVudExpc3RlbmVyKFxuICAgICAgICAgICAgICAgICAgICBRdWVyeS5wcm90b3R5cGUuQ09NUE9ORU5UX0NIQU5HRUQsXG4gICAgICAgICAgICAgICAgICAgIGVudGl0eSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgLy8gQXZvaWQgZHVwbGljYXRlc1xuICAgICAgICAgICAgICAgICAgICAgIGlmIChldmVudExpc3QuaW5kZXhPZihlbnRpdHkpID09PSAtMSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgZXZlbnRMaXN0LnB1c2goZW50aXR5KTtcbiAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChBcnJheS5pc0FycmF5KGV2ZW50KSkge1xuICAgICAgICAgICAgICAgICAgbGV0IGV2ZW50TGlzdCA9ICh0aGlzLnF1ZXJpZXNbcXVlcnlOYW1lXVtldmVudE5hbWVdID0gW10pO1xuICAgICAgICAgICAgICAgICAgcXVlcnkuZXZlbnREaXNwYXRjaGVyLmFkZEV2ZW50TGlzdGVuZXIoXG4gICAgICAgICAgICAgICAgICAgIFF1ZXJ5LnByb3RvdHlwZS5DT01QT05FTlRfQ0hBTkdFRCxcbiAgICAgICAgICAgICAgICAgICAgKGVudGl0eSwgY2hhbmdlZENvbXBvbmVudCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgIC8vIEF2b2lkIGR1cGxpY2F0ZXNcbiAgICAgICAgICAgICAgICAgICAgICBpZiAoXG4gICAgICAgICAgICAgICAgICAgICAgICBldmVudC5pbmRleE9mKGNoYW5nZWRDb21wb25lbnQuY29uc3RydWN0b3IpICE9PSAtMSAmJlxuICAgICAgICAgICAgICAgICAgICAgICAgZXZlbnRMaXN0LmluZGV4T2YoZW50aXR5KSA9PT0gLTFcbiAgICAgICAgICAgICAgICAgICAgICApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGV2ZW50TGlzdC5wdXNoKGVudGl0eSk7XG4gICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAvKlxuICAgICAgICAgICAgICAgICAgLy8gQ2hlY2tpbmcganVzdCBzcGVjaWZpYyBjb21wb25lbnRzXG4gICAgICAgICAgICAgICAgICBsZXQgY2hhbmdlZExpc3QgPSAodGhpcy5xdWVyaWVzW3F1ZXJ5TmFtZV1bZXZlbnROYW1lXSA9IHt9KTtcbiAgICAgICAgICAgICAgICAgIGV2ZW50LmZvckVhY2goY29tcG9uZW50ID0+IHtcbiAgICAgICAgICAgICAgICAgICAgbGV0IGV2ZW50TGlzdCA9IChjaGFuZ2VkTGlzdFtcbiAgICAgICAgICAgICAgICAgICAgICBjb21wb25lbnRQcm9wZXJ0eU5hbWUoY29tcG9uZW50KVxuICAgICAgICAgICAgICAgICAgICBdID0gW10pO1xuICAgICAgICAgICAgICAgICAgICBxdWVyeS5ldmVudERpc3BhdGNoZXIuYWRkRXZlbnRMaXN0ZW5lcihcbiAgICAgICAgICAgICAgICAgICAgICBRdWVyeS5wcm90b3R5cGUuQ09NUE9ORU5UX0NIQU5HRUQsXG4gICAgICAgICAgICAgICAgICAgICAgKGVudGl0eSwgY2hhbmdlZENvbXBvbmVudCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKFxuICAgICAgICAgICAgICAgICAgICAgICAgICBjaGFuZ2VkQ29tcG9uZW50LmNvbnN0cnVjdG9yID09PSBjb21wb25lbnQgJiZcbiAgICAgICAgICAgICAgICAgICAgICAgICAgZXZlbnRMaXN0LmluZGV4T2YoZW50aXR5KSA9PT0gLTFcbiAgICAgICAgICAgICAgICAgICAgICAgICkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBldmVudExpc3QucHVzaChlbnRpdHkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgKi9cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgbGV0IGV2ZW50TGlzdCA9ICh0aGlzLnF1ZXJpZXNbcXVlcnlOYW1lXVtldmVudE5hbWVdID0gW10pO1xuXG4gICAgICAgICAgICAgICAgcXVlcnkuZXZlbnREaXNwYXRjaGVyLmFkZEV2ZW50TGlzdGVuZXIoXG4gICAgICAgICAgICAgICAgICBldmVudE1hcHBpbmdbZXZlbnROYW1lXSxcbiAgICAgICAgICAgICAgICAgIGVudGl0eSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIC8vIEBmaXhtZSBvdmVyaGVhZD9cbiAgICAgICAgICAgICAgICAgICAgaWYgKGV2ZW50TGlzdC5pbmRleE9mKGVudGl0eSkgPT09IC0xKVxuICAgICAgICAgICAgICAgICAgICAgIGV2ZW50TGlzdC5wdXNoKGVudGl0eSk7XG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgc3RvcCgpIHtcbiAgICB0aGlzLmV4ZWN1dGVUaW1lID0gMDtcbiAgICB0aGlzLmVuYWJsZWQgPSBmYWxzZTtcbiAgfVxuXG4gIHBsYXkoKSB7XG4gICAgdGhpcy5lbmFibGVkID0gdHJ1ZTtcbiAgfVxuXG4gIC8vIEBxdWVzdGlvbiByZW5hbWUgdG8gY2xlYXIgcXVldWVzP1xuICBjbGVhckV2ZW50cygpIHtcbiAgICBmb3IgKGxldCBxdWVyeU5hbWUgaW4gdGhpcy5xdWVyaWVzKSB7XG4gICAgICB2YXIgcXVlcnkgPSB0aGlzLnF1ZXJpZXNbcXVlcnlOYW1lXTtcbiAgICAgIGlmIChxdWVyeS5hZGRlZCkge1xuICAgICAgICBxdWVyeS5hZGRlZC5sZW5ndGggPSAwO1xuICAgICAgfVxuICAgICAgaWYgKHF1ZXJ5LnJlbW92ZWQpIHtcbiAgICAgICAgcXVlcnkucmVtb3ZlZC5sZW5ndGggPSAwO1xuICAgICAgfVxuICAgICAgaWYgKHF1ZXJ5LmNoYW5nZWQpIHtcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkocXVlcnkuY2hhbmdlZCkpIHtcbiAgICAgICAgICBxdWVyeS5jaGFuZ2VkLmxlbmd0aCA9IDA7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgZm9yIChsZXQgbmFtZSBpbiBxdWVyeS5jaGFuZ2VkKSB7XG4gICAgICAgICAgICBxdWVyeS5jaGFuZ2VkW25hbWVdLmxlbmd0aCA9IDA7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgdG9KU09OKCkge1xuICAgIHZhciBqc29uID0ge1xuICAgICAgbmFtZTogdGhpcy5jb25zdHJ1Y3Rvci5uYW1lLFxuICAgICAgZW5hYmxlZDogdGhpcy5lbmFibGVkLFxuICAgICAgZXhlY3V0ZVRpbWU6IHRoaXMuZXhlY3V0ZVRpbWUsXG4gICAgICBwcmlvcml0eTogdGhpcy5wcmlvcml0eSxcbiAgICAgIHF1ZXJpZXM6IHt9XG4gICAgfTtcblxuICAgIGlmICh0aGlzLmNvbnN0cnVjdG9yLnF1ZXJpZXMpIHtcbiAgICAgIHZhciBxdWVyaWVzID0gdGhpcy5jb25zdHJ1Y3Rvci5xdWVyaWVzO1xuICAgICAgZm9yIChsZXQgcXVlcnlOYW1lIGluIHF1ZXJpZXMpIHtcbiAgICAgICAgbGV0IHF1ZXJ5ID0gdGhpcy5xdWVyaWVzW3F1ZXJ5TmFtZV07XG4gICAgICAgIGxldCBxdWVyeURlZmluaXRpb24gPSBxdWVyaWVzW3F1ZXJ5TmFtZV07XG4gICAgICAgIGxldCBqc29uUXVlcnkgPSAoanNvbi5xdWVyaWVzW3F1ZXJ5TmFtZV0gPSB7XG4gICAgICAgICAga2V5OiB0aGlzLl9xdWVyaWVzW3F1ZXJ5TmFtZV0ua2V5XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGpzb25RdWVyeS5tYW5kYXRvcnkgPSBxdWVyeURlZmluaXRpb24ubWFuZGF0b3J5ID09PSB0cnVlO1xuICAgICAgICBqc29uUXVlcnkucmVhY3RpdmUgPVxuICAgICAgICAgIHF1ZXJ5RGVmaW5pdGlvbi5saXN0ZW4gJiZcbiAgICAgICAgICAocXVlcnlEZWZpbml0aW9uLmxpc3Rlbi5hZGRlZCA9PT0gdHJ1ZSB8fFxuICAgICAgICAgICAgcXVlcnlEZWZpbml0aW9uLmxpc3Rlbi5yZW1vdmVkID09PSB0cnVlIHx8XG4gICAgICAgICAgICBxdWVyeURlZmluaXRpb24ubGlzdGVuLmNoYW5nZWQgPT09IHRydWUgfHxcbiAgICAgICAgICAgIEFycmF5LmlzQXJyYXkocXVlcnlEZWZpbml0aW9uLmxpc3Rlbi5jaGFuZ2VkKSk7XG5cbiAgICAgICAgaWYgKGpzb25RdWVyeS5yZWFjdGl2ZSkge1xuICAgICAgICAgIGpzb25RdWVyeS5saXN0ZW4gPSB7fTtcblxuICAgICAgICAgIGNvbnN0IG1ldGhvZHMgPSBbXCJhZGRlZFwiLCBcInJlbW92ZWRcIiwgXCJjaGFuZ2VkXCJdO1xuICAgICAgICAgIG1ldGhvZHMuZm9yRWFjaChtZXRob2QgPT4ge1xuICAgICAgICAgICAgaWYgKHF1ZXJ5W21ldGhvZF0pIHtcbiAgICAgICAgICAgICAganNvblF1ZXJ5Lmxpc3RlblttZXRob2RdID0ge1xuICAgICAgICAgICAgICAgIGVudGl0aWVzOiBxdWVyeVttZXRob2RdLmxlbmd0aFxuICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGpzb247XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIE5vdChDb21wb25lbnQpIHtcbiAgcmV0dXJuIHtcbiAgICBvcGVyYXRvcjogXCJub3RcIixcbiAgICBDb21wb25lbnQ6IENvbXBvbmVudFxuICB9O1xufVxuIiwiaW1wb3J0IHsgbm93IH0gZnJvbSBcIi4vVXRpbHMuanNcIjtcbmltcG9ydCB7IFN5c3RlbSB9IGZyb20gXCIuL1N5c3RlbS5qc1wiO1xuXG5leHBvcnQgY2xhc3MgU3lzdGVtTWFuYWdlciB7XG4gIGNvbnN0cnVjdG9yKHdvcmxkKSB7XG4gICAgdGhpcy5fc3lzdGVtcyA9IFtdO1xuICAgIHRoaXMuX2V4ZWN1dGVTeXN0ZW1zID0gW107IC8vIFN5c3RlbXMgdGhhdCBoYXZlIGBleGVjdXRlYCBtZXRob2RcbiAgICB0aGlzLndvcmxkID0gd29ybGQ7XG4gICAgdGhpcy5sYXN0RXhlY3V0ZWRTeXN0ZW0gPSBudWxsO1xuICB9XG5cbiAgcmVnaXN0ZXJTeXN0ZW0oU3lzdGVtQ2xhc3MsIGF0dHJpYnV0ZXMpIHtcbiAgICBpZiAoIShTeXN0ZW1DbGFzcy5wcm90b3R5cGUgaW5zdGFuY2VvZiBTeXN0ZW0pKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIGBTeXN0ZW0gJyR7U3lzdGVtQ2xhc3MubmFtZX0nIGRvZXMgbm90IGV4dGVuZHMgJ1N5c3RlbScgY2xhc3NgXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAodGhpcy5nZXRTeXN0ZW0oU3lzdGVtQ2xhc3MpICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGNvbnNvbGUud2FybihgU3lzdGVtICcke1N5c3RlbUNsYXNzLm5hbWV9JyBhbHJlYWR5IHJlZ2lzdGVyZWQuYCk7XG4gICAgICByZXR1cm4gdGhpcztcbiAgICB9XG5cbiAgICB2YXIgc3lzdGVtID0gbmV3IFN5c3RlbUNsYXNzKHRoaXMud29ybGQsIGF0dHJpYnV0ZXMpO1xuICAgIGlmIChzeXN0ZW0uaW5pdCkgc3lzdGVtLmluaXQoYXR0cmlidXRlcyk7XG4gICAgc3lzdGVtLm9yZGVyID0gdGhpcy5fc3lzdGVtcy5sZW5ndGg7XG4gICAgdGhpcy5fc3lzdGVtcy5wdXNoKHN5c3RlbSk7XG4gICAgaWYgKHN5c3RlbS5leGVjdXRlKSB7XG4gICAgICB0aGlzLl9leGVjdXRlU3lzdGVtcy5wdXNoKHN5c3RlbSk7XG4gICAgICB0aGlzLnNvcnRTeXN0ZW1zKCk7XG4gICAgfVxuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgdW5yZWdpc3RlclN5c3RlbShTeXN0ZW1DbGFzcykge1xuICAgIGxldCBzeXN0ZW0gPSB0aGlzLmdldFN5c3RlbShTeXN0ZW1DbGFzcyk7XG4gICAgaWYgKHN5c3RlbSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBjb25zb2xlLndhcm4oXG4gICAgICAgIGBDYW4gdW5yZWdpc3RlciBzeXN0ZW0gJyR7U3lzdGVtQ2xhc3MubmFtZX0nLiBJdCBkb2Vzbid0IGV4aXN0LmBcbiAgICAgICk7XG4gICAgICByZXR1cm4gdGhpcztcbiAgICB9XG5cbiAgICB0aGlzLl9zeXN0ZW1zLnNwbGljZSh0aGlzLl9zeXN0ZW1zLmluZGV4T2Yoc3lzdGVtKSwgMSk7XG5cbiAgICBpZiAoc3lzdGVtLmV4ZWN1dGUpIHtcbiAgICAgIHRoaXMuX2V4ZWN1dGVTeXN0ZW1zLnNwbGljZSh0aGlzLl9leGVjdXRlU3lzdGVtcy5pbmRleE9mKHN5c3RlbSksIDEpO1xuICAgIH1cblxuICAgIC8vIEB0b2RvIEFkZCBzeXN0ZW0udW5yZWdpc3RlcigpIGNhbGwgdG8gZnJlZSByZXNvdXJjZXNcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIHNvcnRTeXN0ZW1zKCkge1xuICAgIHRoaXMuX2V4ZWN1dGVTeXN0ZW1zLnNvcnQoKGEsIGIpID0+IHtcbiAgICAgIHJldHVybiBhLnByaW9yaXR5IC0gYi5wcmlvcml0eSB8fCBhLm9yZGVyIC0gYi5vcmRlcjtcbiAgICB9KTtcbiAgfVxuXG4gIGdldFN5c3RlbShTeXN0ZW1DbGFzcykge1xuICAgIHJldHVybiB0aGlzLl9zeXN0ZW1zLmZpbmQocyA9PiBzIGluc3RhbmNlb2YgU3lzdGVtQ2xhc3MpO1xuICB9XG5cbiAgZ2V0U3lzdGVtcygpIHtcbiAgICByZXR1cm4gdGhpcy5fc3lzdGVtcztcbiAgfVxuXG4gIHJlbW92ZVN5c3RlbShTeXN0ZW1DbGFzcykge1xuICAgIHZhciBpbmRleCA9IHRoaXMuX3N5c3RlbXMuaW5kZXhPZihTeXN0ZW1DbGFzcyk7XG4gICAgaWYgKCF+aW5kZXgpIHJldHVybjtcblxuICAgIHRoaXMuX3N5c3RlbXMuc3BsaWNlKGluZGV4LCAxKTtcbiAgfVxuXG4gIGV4ZWN1dGVTeXN0ZW0oc3lzdGVtLCBkZWx0YSwgdGltZSkge1xuICAgIGlmIChzeXN0ZW0uaW5pdGlhbGl6ZWQpIHtcbiAgICAgIGlmIChzeXN0ZW0uY2FuRXhlY3V0ZSgpKSB7XG4gICAgICAgIGxldCBzdGFydFRpbWUgPSBub3coKTtcbiAgICAgICAgc3lzdGVtLmV4ZWN1dGUoZGVsdGEsIHRpbWUpO1xuICAgICAgICBzeXN0ZW0uZXhlY3V0ZVRpbWUgPSBub3coKSAtIHN0YXJ0VGltZTtcbiAgICAgICAgdGhpcy5sYXN0RXhlY3V0ZWRTeXN0ZW0gPSBzeXN0ZW07XG4gICAgICAgIHN5c3RlbS5jbGVhckV2ZW50cygpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHN0b3AoKSB7XG4gICAgdGhpcy5fZXhlY3V0ZVN5c3RlbXMuZm9yRWFjaChzeXN0ZW0gPT4gc3lzdGVtLnN0b3AoKSk7XG4gIH1cblxuICBleGVjdXRlKGRlbHRhLCB0aW1lLCBmb3JjZVBsYXkpIHtcbiAgICB0aGlzLl9leGVjdXRlU3lzdGVtcy5mb3JFYWNoKFxuICAgICAgc3lzdGVtID0+XG4gICAgICAgIChmb3JjZVBsYXkgfHwgc3lzdGVtLmVuYWJsZWQpICYmIHRoaXMuZXhlY3V0ZVN5c3RlbShzeXN0ZW0sIGRlbHRhLCB0aW1lKVxuICAgICk7XG4gIH1cblxuICBzdGF0cygpIHtcbiAgICB2YXIgc3RhdHMgPSB7XG4gICAgICBudW1TeXN0ZW1zOiB0aGlzLl9zeXN0ZW1zLmxlbmd0aCxcbiAgICAgIHN5c3RlbXM6IHt9XG4gICAgfTtcblxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy5fc3lzdGVtcy5sZW5ndGg7IGkrKykge1xuICAgICAgdmFyIHN5c3RlbSA9IHRoaXMuX3N5c3RlbXNbaV07XG4gICAgICB2YXIgc3lzdGVtU3RhdHMgPSAoc3RhdHMuc3lzdGVtc1tzeXN0ZW0uY29uc3RydWN0b3IubmFtZV0gPSB7XG4gICAgICAgIHF1ZXJpZXM6IHt9LFxuICAgICAgICBleGVjdXRlVGltZTogc3lzdGVtLmV4ZWN1dGVUaW1lXG4gICAgICB9KTtcbiAgICAgIGZvciAodmFyIG5hbWUgaW4gc3lzdGVtLmN0eCkge1xuICAgICAgICBzeXN0ZW1TdGF0cy5xdWVyaWVzW25hbWVdID0gc3lzdGVtLmN0eFtuYW1lXS5zdGF0cygpO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBzdGF0cztcbiAgfVxufVxuIiwiZXhwb3J0IGRlZmF1bHQgY2xhc3MgT2JqZWN0UG9vbCB7XG4gIC8vIEB0b2RvIEFkZCBpbml0aWFsIHNpemVcbiAgY29uc3RydWN0b3IoVCwgaW5pdGlhbFNpemUpIHtcbiAgICB0aGlzLmZyZWVMaXN0ID0gW107XG4gICAgdGhpcy5jb3VudCA9IDA7XG4gICAgdGhpcy5UID0gVDtcbiAgICB0aGlzLmlzT2JqZWN0UG9vbCA9IHRydWU7XG5cbiAgICB2YXIgZXh0cmFBcmdzID0gbnVsbDtcbiAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA+IDEpIHtcbiAgICAgIGV4dHJhQXJncyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cyk7XG4gICAgICBleHRyYUFyZ3Muc2hpZnQoKTtcbiAgICB9XG5cbiAgICB0aGlzLmNyZWF0ZUVsZW1lbnQgPSBleHRyYUFyZ3NcbiAgICAgID8gKCkgPT4ge1xuICAgICAgICAgIHJldHVybiBuZXcgVCguLi5leHRyYUFyZ3MpO1xuICAgICAgICB9XG4gICAgICA6ICgpID0+IHtcbiAgICAgICAgICByZXR1cm4gbmV3IFQoKTtcbiAgICAgICAgfTtcblxuICAgIGlmICh0eXBlb2YgaW5pdGlhbFNpemUgIT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICAgIHRoaXMuZXhwYW5kKGluaXRpYWxTaXplKTtcbiAgICB9XG4gIH1cblxuICBhY3F1aXJlKCkge1xuICAgIC8vIEdyb3cgdGhlIGxpc3QgYnkgMjAlaXNoIGlmIHdlJ3JlIG91dFxuICAgIGlmICh0aGlzLmZyZWVMaXN0Lmxlbmd0aCA8PSAwKSB7XG4gICAgICB0aGlzLmV4cGFuZChNYXRoLnJvdW5kKHRoaXMuY291bnQgKiAwLjIpICsgMSk7XG4gICAgfVxuXG4gICAgdmFyIGl0ZW0gPSB0aGlzLmZyZWVMaXN0LnBvcCgpO1xuXG4gICAgcmV0dXJuIGl0ZW07XG4gIH1cblxuICByZWxlYXNlKGl0ZW0pIHtcbiAgICBpdGVtLnJlc2V0KCk7XG4gICAgdGhpcy5mcmVlTGlzdC5wdXNoKGl0ZW0pO1xuICB9XG5cbiAgZXhwYW5kKGNvdW50KSB7XG4gICAgZm9yICh2YXIgbiA9IDA7IG4gPCBjb3VudDsgbisrKSB7XG4gICAgICB0aGlzLmZyZWVMaXN0LnB1c2godGhpcy5jcmVhdGVFbGVtZW50KCkpO1xuICAgIH1cbiAgICB0aGlzLmNvdW50ICs9IGNvdW50O1xuICB9XG5cbiAgdG90YWxTaXplKCkge1xuICAgIHJldHVybiB0aGlzLmNvdW50O1xuICB9XG5cbiAgdG90YWxGcmVlKCkge1xuICAgIHJldHVybiB0aGlzLmZyZWVMaXN0Lmxlbmd0aDtcbiAgfVxuXG4gIHRvdGFsVXNlZCgpIHtcbiAgICByZXR1cm4gdGhpcy5jb3VudCAtIHRoaXMuZnJlZUxpc3QubGVuZ3RoO1xuICB9XG59XG4iLCJpbXBvcnQgUXVlcnkgZnJvbSBcIi4vUXVlcnkuanNcIjtcbmltcG9ydCB7IHF1ZXJ5S2V5IH0gZnJvbSBcIi4vVXRpbHMuanNcIjtcblxuLyoqXG4gKiBAcHJpdmF0ZVxuICogQGNsYXNzIFF1ZXJ5TWFuYWdlclxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBRdWVyeU1hbmFnZXIge1xuICBjb25zdHJ1Y3Rvcih3b3JsZCkge1xuICAgIHRoaXMuX3dvcmxkID0gd29ybGQ7XG5cbiAgICAvLyBRdWVyaWVzIGluZGV4ZWQgYnkgYSB1bmlxdWUgaWRlbnRpZmllciBmb3IgdGhlIGNvbXBvbmVudHMgaXQgaGFzXG4gICAgdGhpcy5fcXVlcmllcyA9IHt9O1xuICB9XG5cbiAgb25FbnRpdHlSZW1vdmVkKGVudGl0eSkge1xuICAgIGZvciAodmFyIHF1ZXJ5TmFtZSBpbiB0aGlzLl9xdWVyaWVzKSB7XG4gICAgICB2YXIgcXVlcnkgPSB0aGlzLl9xdWVyaWVzW3F1ZXJ5TmFtZV07XG4gICAgICBpZiAoZW50aXR5LnF1ZXJpZXMuaW5kZXhPZihxdWVyeSkgIT09IC0xKSB7XG4gICAgICAgIHF1ZXJ5LnJlbW92ZUVudGl0eShlbnRpdHkpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxsYmFjayB3aGVuIGEgY29tcG9uZW50IGlzIGFkZGVkIHRvIGFuIGVudGl0eVxuICAgKiBAcGFyYW0ge0VudGl0eX0gZW50aXR5IEVudGl0eSB0aGF0IGp1c3QgZ290IHRoZSBuZXcgY29tcG9uZW50XG4gICAqIEBwYXJhbSB7Q29tcG9uZW50fSBDb21wb25lbnQgQ29tcG9uZW50IGFkZGVkIHRvIHRoZSBlbnRpdHlcbiAgICovXG4gIG9uRW50aXR5Q29tcG9uZW50QWRkZWQoZW50aXR5LCBDb21wb25lbnQpIHtcbiAgICAvLyBAdG9kbyBVc2UgYml0bWFzayBmb3IgY2hlY2tpbmcgY29tcG9uZW50cz9cblxuICAgIC8vIENoZWNrIGVhY2ggaW5kZXhlZCBxdWVyeSB0byBzZWUgaWYgd2UgbmVlZCB0byBhZGQgdGhpcyBlbnRpdHkgdG8gdGhlIGxpc3RcbiAgICBmb3IgKHZhciBxdWVyeU5hbWUgaW4gdGhpcy5fcXVlcmllcykge1xuICAgICAgdmFyIHF1ZXJ5ID0gdGhpcy5fcXVlcmllc1txdWVyeU5hbWVdO1xuXG4gICAgICBpZiAoXG4gICAgICAgICEhfnF1ZXJ5Lk5vdENvbXBvbmVudHMuaW5kZXhPZihDb21wb25lbnQpICYmXG4gICAgICAgIH5xdWVyeS5lbnRpdGllcy5pbmRleE9mKGVudGl0eSlcbiAgICAgICkge1xuICAgICAgICBxdWVyeS5yZW1vdmVFbnRpdHkoZW50aXR5KTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIC8vIEFkZCB0aGUgZW50aXR5IG9ubHkgaWY6XG4gICAgICAvLyBDb21wb25lbnQgaXMgaW4gdGhlIHF1ZXJ5XG4gICAgICAvLyBhbmQgRW50aXR5IGhhcyBBTEwgdGhlIGNvbXBvbmVudHMgb2YgdGhlIHF1ZXJ5XG4gICAgICAvLyBhbmQgRW50aXR5IGlzIG5vdCBhbHJlYWR5IGluIHRoZSBxdWVyeVxuICAgICAgaWYgKFxuICAgICAgICAhfnF1ZXJ5LkNvbXBvbmVudHMuaW5kZXhPZihDb21wb25lbnQpIHx8XG4gICAgICAgICFxdWVyeS5tYXRjaChlbnRpdHkpIHx8XG4gICAgICAgIH5xdWVyeS5lbnRpdGllcy5pbmRleE9mKGVudGl0eSlcbiAgICAgIClcbiAgICAgICAgY29udGludWU7XG5cbiAgICAgIHF1ZXJ5LmFkZEVudGl0eShlbnRpdHkpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxsYmFjayB3aGVuIGEgY29tcG9uZW50IGlzIHJlbW92ZWQgZnJvbSBhbiBlbnRpdHlcbiAgICogQHBhcmFtIHtFbnRpdHl9IGVudGl0eSBFbnRpdHkgdG8gcmVtb3ZlIHRoZSBjb21wb25lbnQgZnJvbVxuICAgKiBAcGFyYW0ge0NvbXBvbmVudH0gQ29tcG9uZW50IENvbXBvbmVudCB0byByZW1vdmUgZnJvbSB0aGUgZW50aXR5XG4gICAqL1xuICBvbkVudGl0eUNvbXBvbmVudFJlbW92ZWQoZW50aXR5LCBDb21wb25lbnQpIHtcbiAgICBmb3IgKHZhciBxdWVyeU5hbWUgaW4gdGhpcy5fcXVlcmllcykge1xuICAgICAgdmFyIHF1ZXJ5ID0gdGhpcy5fcXVlcmllc1txdWVyeU5hbWVdO1xuXG4gICAgICBpZiAoXG4gICAgICAgICEhfnF1ZXJ5Lk5vdENvbXBvbmVudHMuaW5kZXhPZihDb21wb25lbnQpICYmXG4gICAgICAgICF+cXVlcnkuZW50aXRpZXMuaW5kZXhPZihlbnRpdHkpICYmXG4gICAgICAgIHF1ZXJ5Lm1hdGNoKGVudGl0eSlcbiAgICAgICkge1xuICAgICAgICBxdWVyeS5hZGRFbnRpdHkoZW50aXR5KTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIGlmIChcbiAgICAgICAgISF+cXVlcnkuQ29tcG9uZW50cy5pbmRleE9mKENvbXBvbmVudCkgJiZcbiAgICAgICAgISF+cXVlcnkuZW50aXRpZXMuaW5kZXhPZihlbnRpdHkpICYmXG4gICAgICAgICFxdWVyeS5tYXRjaChlbnRpdHkpXG4gICAgICApIHtcbiAgICAgICAgcXVlcnkucmVtb3ZlRW50aXR5KGVudGl0eSk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgYSBxdWVyeSBmb3IgdGhlIHNwZWNpZmllZCBjb21wb25lbnRzXG4gICAqIEBwYXJhbSB7Q29tcG9uZW50fSBDb21wb25lbnRzIENvbXBvbmVudHMgdGhhdCB0aGUgcXVlcnkgc2hvdWxkIGhhdmVcbiAgICovXG4gIGdldFF1ZXJ5KENvbXBvbmVudHMpIHtcbiAgICB2YXIga2V5ID0gcXVlcnlLZXkoQ29tcG9uZW50cyk7XG4gICAgdmFyIHF1ZXJ5ID0gdGhpcy5fcXVlcmllc1trZXldO1xuICAgIGlmICghcXVlcnkpIHtcbiAgICAgIHRoaXMuX3F1ZXJpZXNba2V5XSA9IHF1ZXJ5ID0gbmV3IFF1ZXJ5KENvbXBvbmVudHMsIHRoaXMuX3dvcmxkKTtcbiAgICB9XG4gICAgcmV0dXJuIHF1ZXJ5O1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybiBzb21lIHN0YXRzIGZyb20gdGhpcyBjbGFzc1xuICAgKi9cbiAgc3RhdHMoKSB7XG4gICAgdmFyIHN0YXRzID0ge307XG4gICAgZm9yICh2YXIgcXVlcnlOYW1lIGluIHRoaXMuX3F1ZXJpZXMpIHtcbiAgICAgIHN0YXRzW3F1ZXJ5TmFtZV0gPSB0aGlzLl9xdWVyaWVzW3F1ZXJ5TmFtZV0uc3RhdHMoKTtcbiAgICB9XG4gICAgcmV0dXJuIHN0YXRzO1xuICB9XG59XG4iLCJleHBvcnQgY2xhc3MgU3lzdGVtU3RhdGVDb21wb25lbnQge31cblxuU3lzdGVtU3RhdGVDb21wb25lbnQuaXNTeXN0ZW1TdGF0ZUNvbXBvbmVudCA9IHRydWU7XG4iLCJpbXBvcnQgT2JqZWN0UG9vbCBmcm9tIFwiLi9PYmplY3RQb29sLmpzXCI7XG5pbXBvcnQgUXVlcnlNYW5hZ2VyIGZyb20gXCIuL1F1ZXJ5TWFuYWdlci5qc1wiO1xuaW1wb3J0IEV2ZW50RGlzcGF0Y2hlciBmcm9tIFwiLi9FdmVudERpc3BhdGNoZXIuanNcIjtcbmltcG9ydCB7IGNvbXBvbmVudFByb3BlcnR5TmFtZSwgZ2V0TmFtZSB9IGZyb20gXCIuL1V0aWxzLmpzXCI7XG5pbXBvcnQgeyBTeXN0ZW1TdGF0ZUNvbXBvbmVudCB9IGZyb20gXCIuL1N5c3RlbVN0YXRlQ29tcG9uZW50LmpzXCI7XG5cbi8qKlxuICogQHByaXZhdGVcbiAqIEBjbGFzcyBFbnRpdHlNYW5hZ2VyXG4gKi9cbmV4cG9ydCBjbGFzcyBFbnRpdHlNYW5hZ2VyIHtcbiAgY29uc3RydWN0b3Iod29ybGQpIHtcbiAgICB0aGlzLndvcmxkID0gd29ybGQ7XG4gICAgdGhpcy5jb21wb25lbnRzTWFuYWdlciA9IHdvcmxkLmNvbXBvbmVudHNNYW5hZ2VyO1xuXG4gICAgLy8gQWxsIHRoZSBlbnRpdGllcyBpbiB0aGlzIGluc3RhbmNlXG4gICAgdGhpcy5fZW50aXRpZXMgPSBbXTtcblxuICAgIHRoaXMuX2VudGl0aWVzQnlOYW1lcyA9IHt9O1xuXG4gICAgdGhpcy5fcXVlcnlNYW5hZ2VyID0gbmV3IFF1ZXJ5TWFuYWdlcih0aGlzKTtcbiAgICB0aGlzLmV2ZW50RGlzcGF0Y2hlciA9IG5ldyBFdmVudERpc3BhdGNoZXIoKTtcbiAgICB0aGlzLl9lbnRpdHlQb29sID0gbmV3IE9iamVjdFBvb2woXG4gICAgICB0aGlzLndvcmxkLm9wdGlvbnMuZW50aXR5Q2xhc3MsXG4gICAgICB0aGlzLndvcmxkLm9wdGlvbnMuZW50aXR5UG9vbFNpemVcbiAgICApO1xuXG4gICAgLy8gRGVmZXJyZWQgZGVsZXRpb25cbiAgICB0aGlzLmVudGl0aWVzV2l0aENvbXBvbmVudHNUb1JlbW92ZSA9IFtdO1xuICAgIHRoaXMuZW50aXRpZXNUb1JlbW92ZSA9IFtdO1xuICAgIHRoaXMuZGVmZXJyZWRSZW1vdmFsRW5hYmxlZCA9IHRydWU7XG4gIH1cblxuICBnZXRFbnRpdHlCeU5hbWUobmFtZSkge1xuICAgIHJldHVybiB0aGlzLl9lbnRpdGllc0J5TmFtZXNbbmFtZV07XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlIGEgbmV3IGVudGl0eVxuICAgKi9cbiAgY3JlYXRlRW50aXR5KG5hbWUpIHtcbiAgICB2YXIgZW50aXR5ID0gdGhpcy5fZW50aXR5UG9vbC5hY3F1aXJlKCk7XG4gICAgZW50aXR5LmFsaXZlID0gdHJ1ZTtcbiAgICBlbnRpdHkubmFtZSA9IG5hbWUgfHwgXCJcIjtcbiAgICBpZiAobmFtZSkge1xuICAgICAgaWYgKHRoaXMuX2VudGl0aWVzQnlOYW1lc1tuYW1lXSkge1xuICAgICAgICBjb25zb2xlLndhcm4oYEVudGl0eSBuYW1lICcke25hbWV9JyBhbHJlYWR5IGV4aXN0YCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLl9lbnRpdGllc0J5TmFtZXNbbmFtZV0gPSBlbnRpdHk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgZW50aXR5Ll93b3JsZCA9IHRoaXM7XG4gICAgdGhpcy5fZW50aXRpZXMucHVzaChlbnRpdHkpO1xuICAgIHRoaXMuZXZlbnREaXNwYXRjaGVyLmRpc3BhdGNoRXZlbnQoRU5USVRZX0NSRUFURUQsIGVudGl0eSk7XG4gICAgcmV0dXJuIGVudGl0eTtcbiAgfVxuXG4gIC8vIENPTVBPTkVOVFNcblxuICAvKipcbiAgICogQWRkIGEgY29tcG9uZW50IHRvIGFuIGVudGl0eVxuICAgKiBAcGFyYW0ge0VudGl0eX0gZW50aXR5IEVudGl0eSB3aGVyZSB0aGUgY29tcG9uZW50IHdpbGwgYmUgYWRkZWRcbiAgICogQHBhcmFtIHtDb21wb25lbnR9IENvbXBvbmVudCBDb21wb25lbnQgdG8gYmUgYWRkZWQgdG8gdGhlIGVudGl0eVxuICAgKiBAcGFyYW0ge09iamVjdH0gdmFsdWVzIE9wdGlvbmFsIHZhbHVlcyB0byByZXBsYWNlIHRoZSBkZWZhdWx0IGF0dHJpYnV0ZXNcbiAgICovXG4gIGVudGl0eUFkZENvbXBvbmVudChlbnRpdHksIENvbXBvbmVudCwgdmFsdWVzKSB7XG4gICAgaWYgKH5lbnRpdHkuX0NvbXBvbmVudFR5cGVzLmluZGV4T2YoQ29tcG9uZW50KSkge1xuICAgICAgLy8gQHRvZG8gSnVzdCBvbiBkZWJ1ZyBtb2RlXG4gICAgICBjb25zb2xlLndhcm4oXG4gICAgICAgIFwiQ29tcG9uZW50IHR5cGUgYWxyZWFkeSBleGlzdHMgb24gZW50aXR5LlwiLFxuICAgICAgICBlbnRpdHksXG4gICAgICAgIENvbXBvbmVudC5uYW1lXG4gICAgICApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGVudGl0eS5fQ29tcG9uZW50VHlwZXMucHVzaChDb21wb25lbnQpO1xuXG4gICAgaWYgKENvbXBvbmVudC5fX3Byb3RvX18gPT09IFN5c3RlbVN0YXRlQ29tcG9uZW50KSB7XG4gICAgICBlbnRpdHkubnVtU3RhdGVDb21wb25lbnRzKys7XG4gICAgfVxuXG4gICAgdmFyIGNvbXBvbmVudFBvb2wgPSB0aGlzLndvcmxkLmNvbXBvbmVudHNNYW5hZ2VyLmdldENvbXBvbmVudHNQb29sKFxuICAgICAgQ29tcG9uZW50XG4gICAgKTtcbiAgICB2YXIgY29tcG9uZW50ID0gY29tcG9uZW50UG9vbC5hY3F1aXJlKCk7XG5cbiAgICBlbnRpdHkuX2NvbXBvbmVudHNbQ29tcG9uZW50Lm5hbWVdID0gY29tcG9uZW50O1xuXG4gICAgaWYgKHZhbHVlcykge1xuICAgICAgaWYgKGNvbXBvbmVudC5jb3B5KSB7XG4gICAgICAgIGNvbXBvbmVudC5jb3B5KHZhbHVlcyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmb3IgKHZhciBuYW1lIGluIHZhbHVlcykge1xuICAgICAgICAgIGNvbXBvbmVudFtuYW1lXSA9IHZhbHVlc1tuYW1lXTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMuX3F1ZXJ5TWFuYWdlci5vbkVudGl0eUNvbXBvbmVudEFkZGVkKGVudGl0eSwgQ29tcG9uZW50KTtcbiAgICB0aGlzLndvcmxkLmNvbXBvbmVudHNNYW5hZ2VyLmNvbXBvbmVudEFkZGVkVG9FbnRpdHkoQ29tcG9uZW50KTtcblxuICAgIHRoaXMuZXZlbnREaXNwYXRjaGVyLmRpc3BhdGNoRXZlbnQoQ09NUE9ORU5UX0FEREVELCBlbnRpdHksIENvbXBvbmVudCk7XG4gIH1cblxuICAvKipcbiAgICogUmVtb3ZlIGEgY29tcG9uZW50IGZyb20gYW4gZW50aXR5XG4gICAqIEBwYXJhbSB7RW50aXR5fSBlbnRpdHkgRW50aXR5IHdoaWNoIHdpbGwgZ2V0IHJlbW92ZWQgdGhlIGNvbXBvbmVudFxuICAgKiBAcGFyYW0geyp9IENvbXBvbmVudCBDb21wb25lbnQgdG8gcmVtb3ZlIGZyb20gdGhlIGVudGl0eVxuICAgKiBAcGFyYW0ge0Jvb2x9IGltbWVkaWF0ZWx5IElmIHlvdSB3YW50IHRvIHJlbW92ZSB0aGUgY29tcG9uZW50IGltbWVkaWF0ZWx5IGluc3RlYWQgb2YgZGVmZXJyZWQgKERlZmF1bHQgaXMgZmFsc2UpXG4gICAqL1xuICBlbnRpdHlSZW1vdmVDb21wb25lbnQoZW50aXR5LCBDb21wb25lbnQsIGltbWVkaWF0ZWx5KSB7XG4gICAgdmFyIGluZGV4ID0gZW50aXR5Ll9Db21wb25lbnRUeXBlcy5pbmRleE9mKENvbXBvbmVudCk7XG4gICAgaWYgKCF+aW5kZXgpIHJldHVybjtcblxuICAgIHRoaXMuZXZlbnREaXNwYXRjaGVyLmRpc3BhdGNoRXZlbnQoQ09NUE9ORU5UX1JFTU9WRSwgZW50aXR5LCBDb21wb25lbnQpO1xuXG4gICAgaWYgKGltbWVkaWF0ZWx5KSB7XG4gICAgICB0aGlzLl9lbnRpdHlSZW1vdmVDb21wb25lbnRTeW5jKGVudGl0eSwgQ29tcG9uZW50LCBpbmRleCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmIChlbnRpdHkuX0NvbXBvbmVudFR5cGVzVG9SZW1vdmUubGVuZ3RoID09PSAwKVxuICAgICAgICB0aGlzLmVudGl0aWVzV2l0aENvbXBvbmVudHNUb1JlbW92ZS5wdXNoKGVudGl0eSk7XG5cbiAgICAgIGVudGl0eS5fQ29tcG9uZW50VHlwZXMuc3BsaWNlKGluZGV4LCAxKTtcbiAgICAgIGVudGl0eS5fQ29tcG9uZW50VHlwZXNUb1JlbW92ZS5wdXNoKENvbXBvbmVudCk7XG5cbiAgICAgIHZhciBjb21wb25lbnROYW1lID0gZ2V0TmFtZShDb21wb25lbnQpO1xuICAgICAgZW50aXR5Ll9jb21wb25lbnRzVG9SZW1vdmVbY29tcG9uZW50TmFtZV0gPVxuICAgICAgICBlbnRpdHkuX2NvbXBvbmVudHNbY29tcG9uZW50TmFtZV07XG4gICAgICBkZWxldGUgZW50aXR5Ll9jb21wb25lbnRzW2NvbXBvbmVudE5hbWVdO1xuICAgIH1cblxuICAgIC8vIENoZWNrIGVhY2ggaW5kZXhlZCBxdWVyeSB0byBzZWUgaWYgd2UgbmVlZCB0byByZW1vdmUgaXRcbiAgICB0aGlzLl9xdWVyeU1hbmFnZXIub25FbnRpdHlDb21wb25lbnRSZW1vdmVkKGVudGl0eSwgQ29tcG9uZW50KTtcblxuICAgIGlmIChDb21wb25lbnQuX19wcm90b19fID09PSBTeXN0ZW1TdGF0ZUNvbXBvbmVudCkge1xuICAgICAgZW50aXR5Lm51bVN0YXRlQ29tcG9uZW50cy0tO1xuXG4gICAgICAvLyBDaGVjayBpZiB0aGUgZW50aXR5IHdhcyBhIGdob3N0IHdhaXRpbmcgZm9yIHRoZSBsYXN0IHN5c3RlbSBzdGF0ZSBjb21wb25lbnQgdG8gYmUgcmVtb3ZlZFxuICAgICAgaWYgKGVudGl0eS5udW1TdGF0ZUNvbXBvbmVudHMgPT09IDAgJiYgIWVudGl0eS5hbGl2ZSkge1xuICAgICAgICBlbnRpdHkucmVtb3ZlKCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgX2VudGl0eVJlbW92ZUNvbXBvbmVudFN5bmMoZW50aXR5LCBDb21wb25lbnQsIGluZGV4KSB7XG4gICAgLy8gUmVtb3ZlIFQgbGlzdGluZyBvbiBlbnRpdHkgYW5kIHByb3BlcnR5IHJlZiwgdGhlbiBmcmVlIHRoZSBjb21wb25lbnQuXG4gICAgZW50aXR5Ll9Db21wb25lbnRUeXBlcy5zcGxpY2UoaW5kZXgsIDEpO1xuICAgIHZhciBwcm9wTmFtZSA9IGNvbXBvbmVudFByb3BlcnR5TmFtZShDb21wb25lbnQpO1xuICAgIHZhciBjb21wb25lbnROYW1lID0gZ2V0TmFtZShDb21wb25lbnQpO1xuICAgIHZhciBjb21wb25lbnQgPSBlbnRpdHkuX2NvbXBvbmVudHNbY29tcG9uZW50TmFtZV07XG4gICAgZGVsZXRlIGVudGl0eS5fY29tcG9uZW50c1tjb21wb25lbnROYW1lXTtcbiAgICB0aGlzLmNvbXBvbmVudHNNYW5hZ2VyLl9jb21wb25lbnRQb29sW3Byb3BOYW1lXS5yZWxlYXNlKGNvbXBvbmVudCk7XG4gICAgdGhpcy53b3JsZC5jb21wb25lbnRzTWFuYWdlci5jb21wb25lbnRSZW1vdmVkRnJvbUVudGl0eShDb21wb25lbnQpO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlbW92ZSBhbGwgdGhlIGNvbXBvbmVudHMgZnJvbSBhbiBlbnRpdHlcbiAgICogQHBhcmFtIHtFbnRpdHl9IGVudGl0eSBFbnRpdHkgZnJvbSB3aGljaCB0aGUgY29tcG9uZW50cyB3aWxsIGJlIHJlbW92ZWRcbiAgICovXG4gIGVudGl0eVJlbW92ZUFsbENvbXBvbmVudHMoZW50aXR5LCBpbW1lZGlhdGVseSkge1xuICAgIGxldCBDb21wb25lbnRzID0gZW50aXR5Ll9Db21wb25lbnRUeXBlcztcblxuICAgIGZvciAobGV0IGogPSBDb21wb25lbnRzLmxlbmd0aCAtIDE7IGogPj0gMDsgai0tKSB7XG4gICAgICBpZiAoQ29tcG9uZW50c1tqXS5fX3Byb3RvX18gIT09IFN5c3RlbVN0YXRlQ29tcG9uZW50KVxuICAgICAgICB0aGlzLmVudGl0eVJlbW92ZUNvbXBvbmVudChlbnRpdHksIENvbXBvbmVudHNbal0sIGltbWVkaWF0ZWx5KTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVtb3ZlIHRoZSBlbnRpdHkgZnJvbSB0aGlzIG1hbmFnZXIuIEl0IHdpbGwgY2xlYXIgYWxzbyBpdHMgY29tcG9uZW50c1xuICAgKiBAcGFyYW0ge0VudGl0eX0gZW50aXR5IEVudGl0eSB0byByZW1vdmUgZnJvbSB0aGUgbWFuYWdlclxuICAgKiBAcGFyYW0ge0Jvb2x9IGltbWVkaWF0ZWx5IElmIHlvdSB3YW50IHRvIHJlbW92ZSB0aGUgY29tcG9uZW50IGltbWVkaWF0ZWx5IGluc3RlYWQgb2YgZGVmZXJyZWQgKERlZmF1bHQgaXMgZmFsc2UpXG4gICAqL1xuICByZW1vdmVFbnRpdHkoZW50aXR5LCBpbW1lZGlhdGVseSkge1xuICAgIHZhciBpbmRleCA9IHRoaXMuX2VudGl0aWVzLmluZGV4T2YoZW50aXR5KTtcblxuICAgIGlmICghfmluZGV4KSB0aHJvdyBuZXcgRXJyb3IoXCJUcmllZCB0byByZW1vdmUgZW50aXR5IG5vdCBpbiBsaXN0XCIpO1xuXG4gICAgZW50aXR5LmFsaXZlID0gZmFsc2U7XG5cbiAgICBpZiAoZW50aXR5Lm51bVN0YXRlQ29tcG9uZW50cyA9PT0gMCkge1xuICAgICAgLy8gUmVtb3ZlIGZyb20gZW50aXR5IGxpc3RcbiAgICAgIHRoaXMuZXZlbnREaXNwYXRjaGVyLmRpc3BhdGNoRXZlbnQoRU5USVRZX1JFTU9WRUQsIGVudGl0eSk7XG4gICAgICB0aGlzLl9xdWVyeU1hbmFnZXIub25FbnRpdHlSZW1vdmVkKGVudGl0eSk7XG4gICAgICBpZiAoaW1tZWRpYXRlbHkgPT09IHRydWUpIHtcbiAgICAgICAgdGhpcy5fcmVsZWFzZUVudGl0eShlbnRpdHksIGluZGV4KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMuZW50aXRpZXNUb1JlbW92ZS5wdXNoKGVudGl0eSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5lbnRpdHlSZW1vdmVBbGxDb21wb25lbnRzKGVudGl0eSwgaW1tZWRpYXRlbHkpO1xuICB9XG5cbiAgX3JlbGVhc2VFbnRpdHkoZW50aXR5LCBpbmRleCkge1xuICAgIHRoaXMuX2VudGl0aWVzLnNwbGljZShpbmRleCwgMSk7XG5cbiAgICBpZiAodGhpcy5fZW50aXRpZXNCeU5hbWVzW2VudGl0eS5uYW1lXSkge1xuICAgICAgZGVsZXRlIHRoaXMuX2VudGl0aWVzQnlOYW1lc1tlbnRpdHkubmFtZV07XG4gICAgfVxuXG4gICAgLy8gUHJldmVudCBhbnkgYWNjZXNzIGFuZCBmcmVlXG4gICAgZW50aXR5Ll93b3JsZCA9IG51bGw7XG4gICAgdGhpcy5fZW50aXR5UG9vbC5yZWxlYXNlKGVudGl0eSk7XG4gIH1cblxuICAvKipcbiAgICogUmVtb3ZlIGFsbCBlbnRpdGllcyBmcm9tIHRoaXMgbWFuYWdlclxuICAgKi9cbiAgcmVtb3ZlQWxsRW50aXRpZXMoKSB7XG4gICAgZm9yICh2YXIgaSA9IHRoaXMuX2VudGl0aWVzLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgICB0aGlzLnJlbW92ZUVudGl0eSh0aGlzLl9lbnRpdGllc1tpXSk7XG4gICAgfVxuICB9XG5cbiAgcHJvY2Vzc0RlZmVycmVkUmVtb3ZhbCgpIHtcbiAgICBpZiAoIXRoaXMuZGVmZXJyZWRSZW1vdmFsRW5hYmxlZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGhpcy5lbnRpdGllc1RvUmVtb3ZlLmxlbmd0aDsgaSsrKSB7XG4gICAgICBsZXQgZW50aXR5ID0gdGhpcy5lbnRpdGllc1RvUmVtb3ZlW2ldO1xuICAgICAgbGV0IGluZGV4ID0gdGhpcy5fZW50aXRpZXMuaW5kZXhPZihlbnRpdHkpO1xuICAgICAgdGhpcy5fcmVsZWFzZUVudGl0eShlbnRpdHksIGluZGV4KTtcbiAgICB9XG4gICAgdGhpcy5lbnRpdGllc1RvUmVtb3ZlLmxlbmd0aCA9IDA7XG5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRoaXMuZW50aXRpZXNXaXRoQ29tcG9uZW50c1RvUmVtb3ZlLmxlbmd0aDsgaSsrKSB7XG4gICAgICBsZXQgZW50aXR5ID0gdGhpcy5lbnRpdGllc1dpdGhDb21wb25lbnRzVG9SZW1vdmVbaV07XG4gICAgICB3aGlsZSAoZW50aXR5Ll9Db21wb25lbnRUeXBlc1RvUmVtb3ZlLmxlbmd0aCA+IDApIHtcbiAgICAgICAgbGV0IENvbXBvbmVudCA9IGVudGl0eS5fQ29tcG9uZW50VHlwZXNUb1JlbW92ZS5wb3AoKTtcblxuICAgICAgICB2YXIgcHJvcE5hbWUgPSBjb21wb25lbnRQcm9wZXJ0eU5hbWUoQ29tcG9uZW50KTtcbiAgICAgICAgdmFyIGNvbXBvbmVudE5hbWUgPSBnZXROYW1lKENvbXBvbmVudCk7XG4gICAgICAgIHZhciBjb21wb25lbnQgPSBlbnRpdHkuX2NvbXBvbmVudHNUb1JlbW92ZVtjb21wb25lbnROYW1lXTtcbiAgICAgICAgZGVsZXRlIGVudGl0eS5fY29tcG9uZW50c1RvUmVtb3ZlW2NvbXBvbmVudE5hbWVdO1xuICAgICAgICB0aGlzLmNvbXBvbmVudHNNYW5hZ2VyLl9jb21wb25lbnRQb29sW3Byb3BOYW1lXS5yZWxlYXNlKGNvbXBvbmVudCk7XG4gICAgICAgIHRoaXMud29ybGQuY29tcG9uZW50c01hbmFnZXIuY29tcG9uZW50UmVtb3ZlZEZyb21FbnRpdHkoQ29tcG9uZW50KTtcblxuICAgICAgICAvL3RoaXMuX2VudGl0eVJlbW92ZUNvbXBvbmVudFN5bmMoZW50aXR5LCBDb21wb25lbnQsIGluZGV4KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLmVudGl0aWVzV2l0aENvbXBvbmVudHNUb1JlbW92ZS5sZW5ndGggPSAwO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCBhIHF1ZXJ5IGJhc2VkIG9uIGEgbGlzdCBvZiBjb21wb25lbnRzXG4gICAqIEBwYXJhbSB7QXJyYXkoQ29tcG9uZW50KX0gQ29tcG9uZW50cyBMaXN0IG9mIGNvbXBvbmVudHMgdGhhdCB3aWxsIGZvcm0gdGhlIHF1ZXJ5XG4gICAqL1xuICBxdWVyeUNvbXBvbmVudHMoQ29tcG9uZW50cykge1xuICAgIHJldHVybiB0aGlzLl9xdWVyeU1hbmFnZXIuZ2V0UXVlcnkoQ29tcG9uZW50cyk7XG4gIH1cblxuICAvLyBFWFRSQVNcblxuICAvKipcbiAgICogUmV0dXJuIG51bWJlciBvZiBlbnRpdGllc1xuICAgKi9cbiAgY291bnQoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2VudGl0aWVzLmxlbmd0aDtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm4gc29tZSBzdGF0c1xuICAgKi9cbiAgc3RhdHMoKSB7XG4gICAgdmFyIHN0YXRzID0ge1xuICAgICAgbnVtRW50aXRpZXM6IHRoaXMuX2VudGl0aWVzLmxlbmd0aCxcbiAgICAgIG51bVF1ZXJpZXM6IE9iamVjdC5rZXlzKHRoaXMuX3F1ZXJ5TWFuYWdlci5fcXVlcmllcykubGVuZ3RoLFxuICAgICAgcXVlcmllczogdGhpcy5fcXVlcnlNYW5hZ2VyLnN0YXRzKCksXG4gICAgICBudW1Db21wb25lbnRQb29sOiBPYmplY3Qua2V5cyh0aGlzLmNvbXBvbmVudHNNYW5hZ2VyLl9jb21wb25lbnRQb29sKVxuICAgICAgICAubGVuZ3RoLFxuICAgICAgY29tcG9uZW50UG9vbDoge30sXG4gICAgICBldmVudERpc3BhdGNoZXI6IHRoaXMuZXZlbnREaXNwYXRjaGVyLnN0YXRzXG4gICAgfTtcblxuICAgIGZvciAodmFyIGNuYW1lIGluIHRoaXMuY29tcG9uZW50c01hbmFnZXIuX2NvbXBvbmVudFBvb2wpIHtcbiAgICAgIHZhciBwb29sID0gdGhpcy5jb21wb25lbnRzTWFuYWdlci5fY29tcG9uZW50UG9vbFtjbmFtZV07XG4gICAgICBzdGF0cy5jb21wb25lbnRQb29sW2NuYW1lXSA9IHtcbiAgICAgICAgdXNlZDogcG9vbC50b3RhbFVzZWQoKSxcbiAgICAgICAgc2l6ZTogcG9vbC5jb3VudFxuICAgICAgfTtcbiAgICB9XG5cbiAgICByZXR1cm4gc3RhdHM7XG4gIH1cbn1cblxuY29uc3QgRU5USVRZX0NSRUFURUQgPSBcIkVudGl0eU1hbmFnZXIjRU5USVRZX0NSRUFURVwiO1xuY29uc3QgRU5USVRZX1JFTU9WRUQgPSBcIkVudGl0eU1hbmFnZXIjRU5USVRZX1JFTU9WRURcIjtcbmNvbnN0IENPTVBPTkVOVF9BRERFRCA9IFwiRW50aXR5TWFuYWdlciNDT01QT05FTlRfQURERURcIjtcbmNvbnN0IENPTVBPTkVOVF9SRU1PVkUgPSBcIkVudGl0eU1hbmFnZXIjQ09NUE9ORU5UX1JFTU9WRVwiO1xuIiwiZXhwb3J0IGRlZmF1bHQgY2xhc3MgRHVtbXlPYmplY3RQb29sIHtcbiAgY29uc3RydWN0b3IoVCkge1xuICAgIHRoaXMuaXNEdW1teU9iamVjdFBvb2wgPSB0cnVlO1xuICAgIHRoaXMuY291bnQgPSAwO1xuICAgIHRoaXMudXNlZCA9IDA7XG4gICAgdGhpcy5UID0gVDtcbiAgfVxuXG4gIGFjcXVpcmUoKSB7XG4gICAgdGhpcy51c2VkKys7XG4gICAgdGhpcy5jb3VudCsrO1xuICAgIHJldHVybiBuZXcgdGhpcy5UKCk7XG4gIH1cblxuICByZWxlYXNlKCkge1xuICAgIHRoaXMudXNlZC0tO1xuICB9XG5cbiAgdG90YWxTaXplKCkge1xuICAgIHJldHVybiB0aGlzLmNvdW50O1xuICB9XG5cbiAgdG90YWxGcmVlKCkge1xuICAgIHJldHVybiBJbmZpbml0eTtcbiAgfVxuXG4gIHRvdGFsVXNlZCgpIHtcbiAgICByZXR1cm4gdGhpcy51c2VkO1xuICB9XG59XG4iLCJpbXBvcnQgT2JqZWN0UG9vbCBmcm9tIFwiLi9PYmplY3RQb29sLmpzXCI7XG5pbXBvcnQgRHVtbXlPYmplY3RQb29sIGZyb20gXCIuL0R1bW15T2JqZWN0UG9vbC5qc1wiO1xuaW1wb3J0IHsgY29tcG9uZW50UHJvcGVydHlOYW1lIH0gZnJvbSBcIi4vVXRpbHMuanNcIjtcblxuZXhwb3J0IGNsYXNzIENvbXBvbmVudE1hbmFnZXIge1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICB0aGlzLkNvbXBvbmVudHMgPSB7fTtcbiAgICB0aGlzLl9jb21wb25lbnRQb29sID0ge307XG4gICAgdGhpcy5udW1Db21wb25lbnRzID0ge307XG4gIH1cblxuICByZWdpc3RlckNvbXBvbmVudChDb21wb25lbnQpIHtcbiAgICBpZiAodGhpcy5Db21wb25lbnRzW0NvbXBvbmVudC5uYW1lXSkge1xuICAgICAgY29uc29sZS53YXJuKGBDb21wb25lbnQgdHlwZTogJyR7Q29tcG9uZW50Lm5hbWV9JyBhbHJlYWR5IHJlZ2lzdGVyZWQuYCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdGhpcy5Db21wb25lbnRzW0NvbXBvbmVudC5uYW1lXSA9IENvbXBvbmVudDtcbiAgICB0aGlzLm51bUNvbXBvbmVudHNbQ29tcG9uZW50Lm5hbWVdID0gMDtcbiAgfVxuXG4gIGNvbXBvbmVudEFkZGVkVG9FbnRpdHkoQ29tcG9uZW50KSB7XG4gICAgaWYgKCF0aGlzLkNvbXBvbmVudHNbQ29tcG9uZW50Lm5hbWVdKSB7XG4gICAgICB0aGlzLnJlZ2lzdGVyQ29tcG9uZW50KENvbXBvbmVudCk7XG4gICAgfVxuXG4gICAgdGhpcy5udW1Db21wb25lbnRzW0NvbXBvbmVudC5uYW1lXSsrO1xuICB9XG5cbiAgY29tcG9uZW50UmVtb3ZlZEZyb21FbnRpdHkoQ29tcG9uZW50KSB7XG4gICAgdGhpcy5udW1Db21wb25lbnRzW0NvbXBvbmVudC5uYW1lXS0tO1xuICB9XG5cbiAgZ2V0Q29tcG9uZW50c1Bvb2woQ29tcG9uZW50KSB7XG4gICAgdmFyIGNvbXBvbmVudE5hbWUgPSBjb21wb25lbnRQcm9wZXJ0eU5hbWUoQ29tcG9uZW50KTtcblxuICAgIGlmICghdGhpcy5fY29tcG9uZW50UG9vbFtjb21wb25lbnROYW1lXSkge1xuICAgICAgaWYgKENvbXBvbmVudC5wcm90b3R5cGUucmVzZXQpIHtcbiAgICAgICAgdGhpcy5fY29tcG9uZW50UG9vbFtjb21wb25lbnROYW1lXSA9IG5ldyBPYmplY3RQb29sKENvbXBvbmVudCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zb2xlLndhcm4oXG4gICAgICAgICAgYENvbXBvbmVudCAnJHtDb21wb25lbnQubmFtZX0nIHdvbid0IGJlbmVmaXQgZnJvbSBwb29saW5nIGJlY2F1c2UgJ3Jlc2V0JyBtZXRob2Qgd2FzIG5vdCBpbXBsZW1lbnRlZC5gXG4gICAgICAgICk7XG4gICAgICAgIHRoaXMuX2NvbXBvbmVudFBvb2xbY29tcG9uZW50TmFtZV0gPSBuZXcgRHVtbXlPYmplY3RQb29sKENvbXBvbmVudCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2NvbXBvbmVudFBvb2xbY29tcG9uZW50TmFtZV07XG4gIH1cbn1cbiIsImltcG9ydCBwanNvbiBmcm9tIFwiLi4vcGFja2FnZS5qc29uXCI7XG5leHBvcnQgY29uc3QgVmVyc2lvbiA9IHBqc29uLnZlcnNpb247XG4iLCJpbXBvcnQgUXVlcnkgZnJvbSBcIi4vUXVlcnkuanNcIjtcbmltcG9ydCB3cmFwSW1tdXRhYmxlQ29tcG9uZW50IGZyb20gXCIuL1dyYXBJbW11dGFibGVDb21wb25lbnQuanNcIjtcblxuLy8gQHRvZG8gVGFrZSB0aGlzIG91dCBmcm9tIHRoZXJlIG9yIHVzZSBFTlZcbmNvbnN0IERFQlVHID0gZmFsc2U7XG5cbnZhciBuZXh0SWQgPSAwO1xuXG5leHBvcnQgY2xhc3MgRW50aXR5IHtcbiAgY29uc3RydWN0b3Iod29ybGQpIHtcbiAgICB0aGlzLl93b3JsZCA9IHdvcmxkIHx8IG51bGw7XG5cbiAgICAvLyBVbmlxdWUgSUQgZm9yIHRoaXMgZW50aXR5XG4gICAgdGhpcy5pZCA9IG5leHRJZCsrO1xuXG4gICAgLy8gTGlzdCBvZiBjb21wb25lbnRzIHR5cGVzIHRoZSBlbnRpdHkgaGFzXG4gICAgdGhpcy5fQ29tcG9uZW50VHlwZXMgPSBbXTtcblxuICAgIC8vIEluc3RhbmNlIG9mIHRoZSBjb21wb25lbnRzXG4gICAgdGhpcy5fY29tcG9uZW50cyA9IHt9O1xuXG4gICAgdGhpcy5fY29tcG9uZW50c1RvUmVtb3ZlID0ge307XG5cbiAgICAvLyBRdWVyaWVzIHdoZXJlIHRoZSBlbnRpdHkgaXMgYWRkZWRcbiAgICB0aGlzLnF1ZXJpZXMgPSBbXTtcblxuICAgIC8vIFVzZWQgZm9yIGRlZmVycmVkIHJlbW92YWxcbiAgICB0aGlzLl9Db21wb25lbnRUeXBlc1RvUmVtb3ZlID0gW107XG5cbiAgICB0aGlzLmFsaXZlID0gZmFsc2U7XG5cbiAgICAvL2lmIHRoZXJlIGFyZSBzdGF0ZSBjb21wb25lbnRzIG9uIGEgZW50aXR5LCBpdCBjYW4ndCBiZSByZW1vdmVkIGNvbXBsZXRlbHlcbiAgICB0aGlzLm51bVN0YXRlQ29tcG9uZW50cyA9IDA7XG4gIH1cblxuICAvLyBDT01QT05FTlRTXG5cbiAgZ2V0Q29tcG9uZW50KENvbXBvbmVudCwgaW5jbHVkZVJlbW92ZWQpIHtcbiAgICB2YXIgY29tcG9uZW50ID0gdGhpcy5fY29tcG9uZW50c1tDb21wb25lbnQubmFtZV07XG5cbiAgICBpZiAoIWNvbXBvbmVudCAmJiBpbmNsdWRlUmVtb3ZlZCA9PT0gdHJ1ZSkge1xuICAgICAgY29tcG9uZW50ID0gdGhpcy5fY29tcG9uZW50c1RvUmVtb3ZlW0NvbXBvbmVudC5uYW1lXTtcbiAgICB9XG5cbiAgICByZXR1cm4gREVCVUcgPyB3cmFwSW1tdXRhYmxlQ29tcG9uZW50KENvbXBvbmVudCwgY29tcG9uZW50KSA6IGNvbXBvbmVudDtcbiAgfVxuXG4gIGdldFJlbW92ZWRDb21wb25lbnQoQ29tcG9uZW50KSB7XG4gICAgcmV0dXJuIHRoaXMuX2NvbXBvbmVudHNUb1JlbW92ZVtDb21wb25lbnQubmFtZV07XG4gIH1cblxuICBnZXRDb21wb25lbnRzKCkge1xuICAgIHJldHVybiB0aGlzLl9jb21wb25lbnRzO1xuICB9XG5cbiAgZ2V0Q29tcG9uZW50c1RvUmVtb3ZlKCkge1xuICAgIHJldHVybiB0aGlzLl9jb21wb25lbnRzVG9SZW1vdmU7XG4gIH1cblxuICBnZXRDb21wb25lbnRUeXBlcygpIHtcbiAgICByZXR1cm4gdGhpcy5fQ29tcG9uZW50VHlwZXM7XG4gIH1cblxuICBnZXRNdXRhYmxlQ29tcG9uZW50KENvbXBvbmVudCkge1xuICAgIHZhciBjb21wb25lbnQgPSB0aGlzLl9jb21wb25lbnRzW0NvbXBvbmVudC5uYW1lXTtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMucXVlcmllcy5sZW5ndGg7IGkrKykge1xuICAgICAgdmFyIHF1ZXJ5ID0gdGhpcy5xdWVyaWVzW2ldO1xuICAgICAgLy8gQHRvZG8gYWNjZWxlcmF0ZSB0aGlzIGNoZWNrLiBNYXliZSBoYXZpbmcgcXVlcnkuX0NvbXBvbmVudHMgYXMgYW4gb2JqZWN0XG4gICAgICAvLyBAdG9kbyBhZGQgTm90IGNvbXBvbmVudHNcbiAgICAgIGlmIChxdWVyeS5yZWFjdGl2ZSAmJiBxdWVyeS5Db21wb25lbnRzLmluZGV4T2YoQ29tcG9uZW50KSAhPT0gLTEpIHtcbiAgICAgICAgcXVlcnkuZXZlbnREaXNwYXRjaGVyLmRpc3BhdGNoRXZlbnQoXG4gICAgICAgICAgUXVlcnkucHJvdG90eXBlLkNPTVBPTkVOVF9DSEFOR0VELFxuICAgICAgICAgIHRoaXMsXG4gICAgICAgICAgY29tcG9uZW50XG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBjb21wb25lbnQ7XG4gIH1cblxuICBhZGRDb21wb25lbnQoQ29tcG9uZW50LCB2YWx1ZXMpIHtcbiAgICB0aGlzLl93b3JsZC5lbnRpdHlBZGRDb21wb25lbnQodGhpcywgQ29tcG9uZW50LCB2YWx1ZXMpO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgcmVtb3ZlQ29tcG9uZW50KENvbXBvbmVudCwgZm9yY2VJbW1lZGlhdGUpIHtcbiAgICB0aGlzLl93b3JsZC5lbnRpdHlSZW1vdmVDb21wb25lbnQodGhpcywgQ29tcG9uZW50LCBmb3JjZUltbWVkaWF0ZSk7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICBoYXNDb21wb25lbnQoQ29tcG9uZW50LCBpbmNsdWRlUmVtb3ZlZCkge1xuICAgIHJldHVybiAoXG4gICAgICAhIX50aGlzLl9Db21wb25lbnRUeXBlcy5pbmRleE9mKENvbXBvbmVudCkgfHxcbiAgICAgIChpbmNsdWRlUmVtb3ZlZCA9PT0gdHJ1ZSAmJiB0aGlzLmhhc1JlbW92ZWRDb21wb25lbnQoQ29tcG9uZW50KSlcbiAgICApO1xuICB9XG5cbiAgaGFzUmVtb3ZlZENvbXBvbmVudChDb21wb25lbnQpIHtcbiAgICByZXR1cm4gISF+dGhpcy5fQ29tcG9uZW50VHlwZXNUb1JlbW92ZS5pbmRleE9mKENvbXBvbmVudCk7XG4gIH1cblxuICBoYXNBbGxDb21wb25lbnRzKENvbXBvbmVudHMpIHtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IENvbXBvbmVudHMubGVuZ3RoOyBpKyspIHtcbiAgICAgIGlmICghdGhpcy5oYXNDb21wb25lbnQoQ29tcG9uZW50c1tpXSkpIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICBoYXNBbnlDb21wb25lbnRzKENvbXBvbmVudHMpIHtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IENvbXBvbmVudHMubGVuZ3RoOyBpKyspIHtcbiAgICAgIGlmICh0aGlzLmhhc0NvbXBvbmVudChDb21wb25lbnRzW2ldKSkgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIHJlbW92ZUFsbENvbXBvbmVudHMoZm9yY2VJbW1lZGlhdGUpIHtcbiAgICByZXR1cm4gdGhpcy5fd29ybGQuZW50aXR5UmVtb3ZlQWxsQ29tcG9uZW50cyh0aGlzLCBmb3JjZUltbWVkaWF0ZSk7XG4gIH1cblxuICAvLyBFWFRSQVNcblxuICAvLyBJbml0aWFsaXplIHRoZSBlbnRpdHkuIFRvIGJlIHVzZWQgd2hlbiByZXR1cm5pbmcgYW4gZW50aXR5IHRvIHRoZSBwb29sXG4gIHJlc2V0KCkge1xuICAgIHRoaXMuaWQgPSBuZXh0SWQrKztcbiAgICB0aGlzLl93b3JsZCA9IG51bGw7XG4gICAgdGhpcy5fQ29tcG9uZW50VHlwZXMubGVuZ3RoID0gMDtcbiAgICB0aGlzLnF1ZXJpZXMubGVuZ3RoID0gMDtcbiAgICB0aGlzLl9jb21wb25lbnRzID0ge307XG4gIH1cblxuICByZW1vdmUoZm9yY2VJbW1lZGlhdGUpIHtcbiAgICByZXR1cm4gdGhpcy5fd29ybGQucmVtb3ZlRW50aXR5KHRoaXMsIGZvcmNlSW1tZWRpYXRlKTtcbiAgfVxufVxuIiwiaW1wb3J0IHsgU3lzdGVtTWFuYWdlciB9IGZyb20gXCIuL1N5c3RlbU1hbmFnZXIuanNcIjtcbmltcG9ydCB7IEVudGl0eU1hbmFnZXIgfSBmcm9tIFwiLi9FbnRpdHlNYW5hZ2VyLmpzXCI7XG5pbXBvcnQgeyBDb21wb25lbnRNYW5hZ2VyIH0gZnJvbSBcIi4vQ29tcG9uZW50TWFuYWdlci5qc1wiO1xuaW1wb3J0IHsgVmVyc2lvbiB9IGZyb20gXCIuL1ZlcnNpb24uanNcIjtcbmltcG9ydCB7IGhhc1dpbmRvdywgbm93IH0gZnJvbSBcIi4vVXRpbHMuanNcIjtcbmltcG9ydCB7IEVudGl0eSB9IGZyb20gXCIuL0VudGl0eS5qc1wiO1xuXG5jb25zdCBERUZBVUxUX09QVElPTlMgPSB7XG4gIGVudGl0eVBvb2xTaXplOiAwLFxuICBlbnRpdHlDbGFzczogRW50aXR5XG59O1xuXG5leHBvcnQgY2xhc3MgV29ybGQge1xuICBjb25zdHJ1Y3RvcihvcHRpb25zID0ge30pIHtcbiAgICB0aGlzLm9wdGlvbnMgPSBPYmplY3QuYXNzaWduKHt9LCBERUZBVUxUX09QVElPTlMsIG9wdGlvbnMpO1xuXG4gICAgdGhpcy5jb21wb25lbnRzTWFuYWdlciA9IG5ldyBDb21wb25lbnRNYW5hZ2VyKHRoaXMpO1xuICAgIHRoaXMuZW50aXR5TWFuYWdlciA9IG5ldyBFbnRpdHlNYW5hZ2VyKHRoaXMpO1xuICAgIHRoaXMuc3lzdGVtTWFuYWdlciA9IG5ldyBTeXN0ZW1NYW5hZ2VyKHRoaXMpO1xuXG4gICAgdGhpcy5lbmFibGVkID0gdHJ1ZTtcblxuICAgIHRoaXMuZXZlbnRRdWV1ZXMgPSB7fTtcblxuICAgIGlmIChoYXNXaW5kb3cgJiYgdHlwZW9mIEN1c3RvbUV2ZW50ICE9PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgICB2YXIgZXZlbnQgPSBuZXcgQ3VzdG9tRXZlbnQoXCJlY3N5LXdvcmxkLWNyZWF0ZWRcIiwge1xuICAgICAgICBkZXRhaWw6IHsgd29ybGQ6IHRoaXMsIHZlcnNpb246IFZlcnNpb24gfVxuICAgICAgfSk7XG4gICAgICB3aW5kb3cuZGlzcGF0Y2hFdmVudChldmVudCk7XG4gICAgfVxuXG4gICAgdGhpcy5sYXN0VGltZSA9IG5vdygpO1xuICB9XG5cbiAgcmVnaXN0ZXJDb21wb25lbnQoQ29tcG9uZW50KSB7XG4gICAgdGhpcy5jb21wb25lbnRzTWFuYWdlci5yZWdpc3RlckNvbXBvbmVudChDb21wb25lbnQpO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgcmVnaXN0ZXJTeXN0ZW0oU3lzdGVtLCBhdHRyaWJ1dGVzKSB7XG4gICAgdGhpcy5zeXN0ZW1NYW5hZ2VyLnJlZ2lzdGVyU3lzdGVtKFN5c3RlbSwgYXR0cmlidXRlcyk7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICB1bnJlZ2lzdGVyU3lzdGVtKFN5c3RlbSkge1xuICAgIHRoaXMuc3lzdGVtTWFuYWdlci51bnJlZ2lzdGVyU3lzdGVtKFN5c3RlbSk7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICBnZXRTeXN0ZW0oU3lzdGVtQ2xhc3MpIHtcbiAgICByZXR1cm4gdGhpcy5zeXN0ZW1NYW5hZ2VyLmdldFN5c3RlbShTeXN0ZW1DbGFzcyk7XG4gIH1cblxuICBnZXRTeXN0ZW1zKCkge1xuICAgIHJldHVybiB0aGlzLnN5c3RlbU1hbmFnZXIuZ2V0U3lzdGVtcygpO1xuICB9XG5cbiAgZXhlY3V0ZShkZWx0YSwgdGltZSkge1xuICAgIGlmICghZGVsdGEpIHtcbiAgICAgIHRpbWUgPSBub3coKTtcbiAgICAgIGRlbHRhID0gdGltZSAtIHRoaXMubGFzdFRpbWU7XG4gICAgICB0aGlzLmxhc3RUaW1lID0gdGltZTtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5lbmFibGVkKSB7XG4gICAgICB0aGlzLnN5c3RlbU1hbmFnZXIuZXhlY3V0ZShkZWx0YSwgdGltZSk7XG4gICAgICB0aGlzLmVudGl0eU1hbmFnZXIucHJvY2Vzc0RlZmVycmVkUmVtb3ZhbCgpO1xuICAgIH1cbiAgfVxuXG4gIHN0b3AoKSB7XG4gICAgdGhpcy5lbmFibGVkID0gZmFsc2U7XG4gIH1cblxuICBwbGF5KCkge1xuICAgIHRoaXMuZW5hYmxlZCA9IHRydWU7XG4gIH1cblxuICBjcmVhdGVFbnRpdHkobmFtZSkge1xuICAgIHJldHVybiB0aGlzLmVudGl0eU1hbmFnZXIuY3JlYXRlRW50aXR5KG5hbWUpO1xuICB9XG5cbiAgc3RhdHMoKSB7XG4gICAgdmFyIHN0YXRzID0ge1xuICAgICAgZW50aXRpZXM6IHRoaXMuZW50aXR5TWFuYWdlci5zdGF0cygpLFxuICAgICAgc3lzdGVtOiB0aGlzLnN5c3RlbU1hbmFnZXIuc3RhdHMoKVxuICAgIH07XG5cbiAgICBjb25zb2xlLmxvZyhKU09OLnN0cmluZ2lmeShzdGF0cywgbnVsbCwgMikpO1xuICB9XG59XG4iLCJleHBvcnQgY2xhc3MgVGFnQ29tcG9uZW50IHtcbiAgcmVzZXQoKSB7fVxufVxuXG5UYWdDb21wb25lbnQuaXNUYWdDb21wb25lbnQgPSB0cnVlO1xuIiwiZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVR5cGUodHlwZURlZmluaXRpb24pIHtcbiAgdmFyIG1hbmRhdG9yeUZ1bmN0aW9ucyA9IFtcbiAgICBcImNyZWF0ZVwiLFxuICAgIFwicmVzZXRcIixcbiAgICBcImNsZWFyXCJcbiAgICAvKlwiY29weVwiKi9cbiAgXTtcblxuICB2YXIgdW5kZWZpbmVkRnVuY3Rpb25zID0gbWFuZGF0b3J5RnVuY3Rpb25zLmZpbHRlcihmID0+IHtcbiAgICByZXR1cm4gIXR5cGVEZWZpbml0aW9uW2ZdO1xuICB9KTtcblxuICBpZiAodW5kZWZpbmVkRnVuY3Rpb25zLmxlbmd0aCA+IDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBgY3JlYXRlVHlwZSBleHBlY3QgdHlwZSBkZWZpbml0aW9uIHRvIGltcGxlbWVudHMgdGhlIGZvbGxvd2luZyBmdW5jdGlvbnM6ICR7dW5kZWZpbmVkRnVuY3Rpb25zLmpvaW4oXG4gICAgICAgIFwiLCBcIlxuICAgICAgKX1gXG4gICAgKTtcbiAgfVxuXG4gIHR5cGVEZWZpbml0aW9uLmlzVHlwZSA9IHRydWU7XG4gIHJldHVybiB0eXBlRGVmaW5pdGlvbjtcbn1cbiIsImltcG9ydCB7IGNyZWF0ZVR5cGUgfSBmcm9tIFwiLi9DcmVhdGVUeXBlXCI7XG5cbi8qKlxuICogU3RhbmRhcmQgdHlwZXNcbiAqL1xudmFyIFR5cGVzID0ge307XG5cblR5cGVzLk51bWJlciA9IGNyZWF0ZVR5cGUoe1xuICBiYXNlVHlwZTogTnVtYmVyLFxuICBpc1NpbXBsZVR5cGU6IHRydWUsXG4gIGNyZWF0ZTogZGVmYXVsdFZhbHVlID0+IHtcbiAgICByZXR1cm4gdHlwZW9mIGRlZmF1bHRWYWx1ZSAhPT0gXCJ1bmRlZmluZWRcIiA/IGRlZmF1bHRWYWx1ZSA6IDA7XG4gIH0sXG4gIHJlc2V0OiAoc3JjLCBrZXksIGRlZmF1bHRWYWx1ZSkgPT4ge1xuICAgIGlmICh0eXBlb2YgZGVmYXVsdFZhbHVlICE9PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgICBzcmNba2V5XSA9IGRlZmF1bHRWYWx1ZTtcbiAgICB9IGVsc2Uge1xuICAgICAgc3JjW2tleV0gPSAwO1xuICAgIH1cbiAgfSxcbiAgY2xlYXI6IChzcmMsIGtleSkgPT4ge1xuICAgIHNyY1trZXldID0gMDtcbiAgfVxufSk7XG5cblR5cGVzLkJvb2xlYW4gPSBjcmVhdGVUeXBlKHtcbiAgYmFzZVR5cGU6IEJvb2xlYW4sXG4gIGlzU2ltcGxlVHlwZTogdHJ1ZSxcbiAgY3JlYXRlOiBkZWZhdWx0VmFsdWUgPT4ge1xuICAgIHJldHVybiB0eXBlb2YgZGVmYXVsdFZhbHVlICE9PSBcInVuZGVmaW5lZFwiID8gZGVmYXVsdFZhbHVlIDogZmFsc2U7XG4gIH0sXG4gIHJlc2V0OiAoc3JjLCBrZXksIGRlZmF1bHRWYWx1ZSkgPT4ge1xuICAgIGlmICh0eXBlb2YgZGVmYXVsdFZhbHVlICE9PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgICBzcmNba2V5XSA9IGRlZmF1bHRWYWx1ZTtcbiAgICB9IGVsc2Uge1xuICAgICAgc3JjW2tleV0gPSBmYWxzZTtcbiAgICB9XG4gIH0sXG4gIGNsZWFyOiAoc3JjLCBrZXkpID0+IHtcbiAgICBzcmNba2V5XSA9IGZhbHNlO1xuICB9XG59KTtcblxuVHlwZXMuU3RyaW5nID0gY3JlYXRlVHlwZSh7XG4gIGJhc2VUeXBlOiBTdHJpbmcsXG4gIGlzU2ltcGxlVHlwZTogdHJ1ZSxcbiAgY3JlYXRlOiBkZWZhdWx0VmFsdWUgPT4ge1xuICAgIHJldHVybiB0eXBlb2YgZGVmYXVsdFZhbHVlICE9PSBcInVuZGVmaW5lZFwiID8gZGVmYXVsdFZhbHVlIDogXCJcIjtcbiAgfSxcbiAgcmVzZXQ6IChzcmMsIGtleSwgZGVmYXVsdFZhbHVlKSA9PiB7XG4gICAgaWYgKHR5cGVvZiBkZWZhdWx0VmFsdWUgIT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICAgIHNyY1trZXldID0gZGVmYXVsdFZhbHVlO1xuICAgIH0gZWxzZSB7XG4gICAgICBzcmNba2V5XSA9IFwiXCI7XG4gICAgfVxuICB9LFxuICBjbGVhcjogKHNyYywga2V5KSA9PiB7XG4gICAgc3JjW2tleV0gPSBcIlwiO1xuICB9XG59KTtcblxuVHlwZXMuQXJyYXkgPSBjcmVhdGVUeXBlKHtcbiAgYmFzZVR5cGU6IEFycmF5LFxuICBjcmVhdGU6IGRlZmF1bHRWYWx1ZSA9PiB7XG4gICAgaWYgKHR5cGVvZiBkZWZhdWx0VmFsdWUgIT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICAgIHJldHVybiBkZWZhdWx0VmFsdWUuc2xpY2UoKTtcbiAgICB9XG5cbiAgICByZXR1cm4gW107XG4gIH0sXG4gIHJlc2V0OiAoc3JjLCBrZXksIGRlZmF1bHRWYWx1ZSkgPT4ge1xuICAgIGlmICh0eXBlb2YgZGVmYXVsdFZhbHVlICE9PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgICBzcmNba2V5XSA9IGRlZmF1bHRWYWx1ZS5zbGljZSgpO1xuICAgIH0gZWxzZSB7XG4gICAgICBzcmNba2V5XS5sZW5ndGggPSAwO1xuICAgIH1cbiAgfSxcbiAgY2xlYXI6IChzcmMsIGtleSkgPT4ge1xuICAgIHNyY1trZXldLmxlbmd0aCA9IDA7XG4gIH0sXG4gIGNvcHk6IChzcmMsIGRzdCwga2V5KSA9PiB7XG4gICAgc3JjW2tleV0gPSBkc3Rba2V5XS5zbGljZSgpO1xuICB9XG59KTtcblxuZXhwb3J0IHsgVHlwZXMgfTtcbiIsImV4cG9ydCBmdW5jdGlvbiBnZW5lcmF0ZUlkKGxlbmd0aCkge1xuICB2YXIgcmVzdWx0ID0gXCJcIjtcbiAgdmFyIGNoYXJhY3RlcnMgPSBcIkFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaMDEyMzQ1Njc4OVwiO1xuICB2YXIgY2hhcmFjdGVyc0xlbmd0aCA9IGNoYXJhY3RlcnMubGVuZ3RoO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgcmVzdWx0ICs9IGNoYXJhY3RlcnMuY2hhckF0KE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIGNoYXJhY3RlcnNMZW5ndGgpKTtcbiAgfVxuICByZXR1cm4gcmVzdWx0O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaW5qZWN0U2NyaXB0KHNyYywgb25Mb2FkKSB7XG4gIHZhciBzY3JpcHQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic2NyaXB0XCIpO1xuICAvLyBAdG9kbyBVc2UgbGluayB0byB0aGUgZWNzeS1kZXZ0b29scyByZXBvP1xuICBzY3JpcHQuc3JjID0gc3JjO1xuICBzY3JpcHQub25sb2FkID0gb25Mb2FkO1xuICAoZG9jdW1lbnQuaGVhZCB8fCBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQpLmFwcGVuZENoaWxkKHNjcmlwdCk7XG59XG4iLCIvKiBnbG9iYWwgUGVlciAqL1xuaW1wb3J0IHsgaW5qZWN0U2NyaXB0LCBnZW5lcmF0ZUlkIH0gZnJvbSBcIi4vdXRpbHMuanNcIjtcbmltcG9ydCB7IGhhc1dpbmRvdyB9IGZyb20gXCIuLi9VdGlscy5qc1wiO1xuXG5mdW5jdGlvbiBob29rQ29uc29sZUFuZEVycm9ycyhjb25uZWN0aW9uKSB7XG4gIHZhciB3cmFwRnVuY3Rpb25zID0gW1wiZXJyb3JcIiwgXCJ3YXJuaW5nXCIsIFwibG9nXCJdO1xuICB3cmFwRnVuY3Rpb25zLmZvckVhY2goa2V5ID0+IHtcbiAgICBpZiAodHlwZW9mIGNvbnNvbGVba2V5XSA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB2YXIgZm4gPSBjb25zb2xlW2tleV0uYmluZChjb25zb2xlKTtcbiAgICAgIGNvbnNvbGVba2V5XSA9ICguLi5hcmdzKSA9PiB7XG4gICAgICAgIGNvbm5lY3Rpb24uc2VuZCh7XG4gICAgICAgICAgbWV0aG9kOiBcImNvbnNvbGVcIixcbiAgICAgICAgICB0eXBlOiBrZXksXG4gICAgICAgICAgYXJnczogSlNPTi5zdHJpbmdpZnkoYXJncylcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiBmbi5hcHBseShudWxsLCBhcmdzKTtcbiAgICAgIH07XG4gICAgfVxuICB9KTtcblxuICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcihcImVycm9yXCIsIGVycm9yID0+IHtcbiAgICBjb25uZWN0aW9uLnNlbmQoe1xuICAgICAgbWV0aG9kOiBcImVycm9yXCIsXG4gICAgICBlcnJvcjogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBtZXNzYWdlOiBlcnJvci5lcnJvci5tZXNzYWdlLFxuICAgICAgICBzdGFjazogZXJyb3IuZXJyb3Iuc3RhY2tcbiAgICAgIH0pXG4gICAgfSk7XG4gIH0pO1xufVxuXG5mdW5jdGlvbiBpbmNsdWRlUmVtb3RlSWRIVE1MKHJlbW90ZUlkKSB7XG4gIGxldCBpbmZvRGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgaW5mb0Rpdi5zdHlsZS5jc3NUZXh0ID0gYFxuICAgIGFsaWduLWl0ZW1zOiBjZW50ZXI7XG4gICAgYmFja2dyb3VuZC1jb2xvcjogIzMzMztcbiAgICBjb2xvcjogI2FhYTtcbiAgICBkaXNwbGF5OmZsZXg7XG4gICAgZm9udC1mYW1pbHk6IEFyaWFsO1xuICAgIGZvbnQtc2l6ZTogMS4xZW07XG4gICAgaGVpZ2h0OiA0MHB4O1xuICAgIGp1c3RpZnktY29udGVudDogY2VudGVyO1xuICAgIGxlZnQ6IDA7XG4gICAgb3BhY2l0eTogMC45O1xuICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcbiAgICByaWdodDogMDtcbiAgICB0ZXh0LWFsaWduOiBjZW50ZXI7XG4gICAgdG9wOiAwO1xuICBgO1xuXG4gIGluZm9EaXYuaW5uZXJIVE1MID0gYE9wZW4gRUNTWSBkZXZ0b29scyB0byBjb25uZWN0IHRvIHRoaXMgcGFnZSB1c2luZyB0aGUgY29kZTombmJzcDs8YiBzdHlsZT1cImNvbG9yOiAjZmZmXCI+JHtyZW1vdGVJZH08L2I+Jm5ic3A7PGJ1dHRvbiBvbkNsaWNrPVwiZ2VuZXJhdGVOZXdDb2RlKClcIj5HZW5lcmF0ZSBuZXcgY29kZTwvYnV0dG9uPmA7XG4gIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoaW5mb0Rpdik7XG5cbiAgcmV0dXJuIGluZm9EaXY7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBlbmFibGVSZW1vdGVEZXZ0b29scyhyZW1vdGVJZCkge1xuICBpZiAoIWhhc1dpbmRvdykge1xuICAgIGNvbnNvbGUud2FybihcIlJlbW90ZSBkZXZ0b29scyBub3QgYXZhaWxhYmxlIG91dHNpZGUgdGhlIGJyb3dzZXJcIik7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgd2luZG93LmdlbmVyYXRlTmV3Q29kZSA9ICgpID0+IHtcbiAgICB3aW5kb3cubG9jYWxTdG9yYWdlLmNsZWFyKCk7XG4gICAgcmVtb3RlSWQgPSBnZW5lcmF0ZUlkKDYpO1xuICAgIHdpbmRvdy5sb2NhbFN0b3JhZ2Uuc2V0SXRlbShcImVjc3lSZW1vdGVJZFwiLCByZW1vdGVJZCk7XG4gICAgd2luZG93LmxvY2F0aW9uLnJlbG9hZChmYWxzZSk7XG4gIH07XG5cbiAgcmVtb3RlSWQgPSByZW1vdGVJZCB8fCB3aW5kb3cubG9jYWxTdG9yYWdlLmdldEl0ZW0oXCJlY3N5UmVtb3RlSWRcIik7XG4gIGlmICghcmVtb3RlSWQpIHtcbiAgICByZW1vdGVJZCA9IGdlbmVyYXRlSWQoNik7XG4gICAgd2luZG93LmxvY2FsU3RvcmFnZS5zZXRJdGVtKFwiZWNzeVJlbW90ZUlkXCIsIHJlbW90ZUlkKTtcbiAgfVxuXG4gIGxldCBpbmZvRGl2ID0gaW5jbHVkZVJlbW90ZUlkSFRNTChyZW1vdGVJZCk7XG5cbiAgd2luZG93Ll9fRUNTWV9SRU1PVEVfREVWVE9PTFNfSU5KRUNURUQgPSB0cnVlO1xuICB3aW5kb3cuX19FQ1NZX1JFTU9URV9ERVZUT09MUyA9IHt9O1xuXG4gIGxldCBWZXJzaW9uID0gXCJcIjtcblxuICAvLyBUaGlzIGlzIHVzZWQgdG8gY29sbGVjdCB0aGUgd29ybGRzIGNyZWF0ZWQgYmVmb3JlIHRoZSBjb21tdW5pY2F0aW9uIGlzIGJlaW5nIGVzdGFibGlzaGVkXG4gIGxldCB3b3JsZHNCZWZvcmVMb2FkaW5nID0gW107XG4gIGxldCBvbldvcmxkQ3JlYXRlZCA9IGUgPT4ge1xuICAgIHZhciB3b3JsZCA9IGUuZGV0YWlsLndvcmxkO1xuICAgIFZlcnNpb24gPSBlLmRldGFpbC52ZXJzaW9uO1xuICAgIHdvcmxkc0JlZm9yZUxvYWRpbmcucHVzaCh3b3JsZCk7XG4gIH07XG4gIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKFwiZWNzeS13b3JsZC1jcmVhdGVkXCIsIG9uV29ybGRDcmVhdGVkKTtcblxuICBsZXQgb25Mb2FkZWQgPSAoKSA9PiB7XG4gICAgdmFyIHBlZXIgPSBuZXcgUGVlcihyZW1vdGVJZCk7XG4gICAgcGVlci5vbihcIm9wZW5cIiwgKC8qIGlkICovKSA9PiB7XG4gICAgICBwZWVyLm9uKFwiY29ubmVjdGlvblwiLCBjb25uZWN0aW9uID0+IHtcbiAgICAgICAgd2luZG93Ll9fRUNTWV9SRU1PVEVfREVWVE9PTFMuY29ubmVjdGlvbiA9IGNvbm5lY3Rpb247XG4gICAgICAgIGNvbm5lY3Rpb24ub24oXCJvcGVuXCIsIGZ1bmN0aW9uKCkge1xuICAgICAgICAgIC8vIGluZm9EaXYuc3R5bGUudmlzaWJpbGl0eSA9IFwiaGlkZGVuXCI7XG4gICAgICAgICAgaW5mb0Rpdi5pbm5lckhUTUwgPSBcIkNvbm5lY3RlZFwiO1xuXG4gICAgICAgICAgLy8gUmVjZWl2ZSBtZXNzYWdlc1xuICAgICAgICAgIGNvbm5lY3Rpb24ub24oXCJkYXRhXCIsIGZ1bmN0aW9uKGRhdGEpIHtcbiAgICAgICAgICAgIGlmIChkYXRhLnR5cGUgPT09IFwiaW5pdFwiKSB7XG4gICAgICAgICAgICAgIHZhciBzY3JpcHQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic2NyaXB0XCIpO1xuICAgICAgICAgICAgICBzY3JpcHQuc2V0QXR0cmlidXRlKFwidHlwZVwiLCBcInRleHQvamF2YXNjcmlwdFwiKTtcbiAgICAgICAgICAgICAgc2NyaXB0Lm9ubG9hZCA9ICgpID0+IHtcbiAgICAgICAgICAgICAgICBzY3JpcHQucGFyZW50Tm9kZS5yZW1vdmVDaGlsZChzY3JpcHQpO1xuXG4gICAgICAgICAgICAgICAgLy8gT25jZSB0aGUgc2NyaXB0IGlzIGluamVjdGVkIHdlIGRvbid0IG5lZWQgdG8gbGlzdGVuXG4gICAgICAgICAgICAgICAgd2luZG93LnJlbW92ZUV2ZW50TGlzdGVuZXIoXG4gICAgICAgICAgICAgICAgICBcImVjc3ktd29ybGQtY3JlYXRlZFwiLFxuICAgICAgICAgICAgICAgICAgb25Xb3JsZENyZWF0ZWRcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgIHdvcmxkc0JlZm9yZUxvYWRpbmcuZm9yRWFjaCh3b3JsZCA9PiB7XG4gICAgICAgICAgICAgICAgICB2YXIgZXZlbnQgPSBuZXcgQ3VzdG9tRXZlbnQoXCJlY3N5LXdvcmxkLWNyZWF0ZWRcIiwge1xuICAgICAgICAgICAgICAgICAgICBkZXRhaWw6IHsgd29ybGQ6IHdvcmxkLCB2ZXJzaW9uOiBWZXJzaW9uIH1cbiAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgd2luZG93LmRpc3BhdGNoRXZlbnQoZXZlbnQpO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICBzY3JpcHQuaW5uZXJIVE1MID0gZGF0YS5zY3JpcHQ7XG4gICAgICAgICAgICAgIChkb2N1bWVudC5oZWFkIHx8IGRvY3VtZW50LmRvY3VtZW50RWxlbWVudCkuYXBwZW5kQ2hpbGQoc2NyaXB0KTtcbiAgICAgICAgICAgICAgc2NyaXB0Lm9ubG9hZCgpO1xuXG4gICAgICAgICAgICAgIGhvb2tDb25zb2xlQW5kRXJyb3JzKGNvbm5lY3Rpb24pO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChkYXRhLnR5cGUgPT09IFwiZXhlY3V0ZVNjcmlwdFwiKSB7XG4gICAgICAgICAgICAgIGxldCB2YWx1ZSA9IGV2YWwoZGF0YS5zY3JpcHQpO1xuICAgICAgICAgICAgICBpZiAoZGF0YS5yZXR1cm5FdmFsKSB7XG4gICAgICAgICAgICAgICAgY29ubmVjdGlvbi5zZW5kKHtcbiAgICAgICAgICAgICAgICAgIG1ldGhvZDogXCJldmFsUmV0dXJuXCIsXG4gICAgICAgICAgICAgICAgICB2YWx1ZTogdmFsdWVcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9O1xuXG4gIC8vIEluamVjdCBQZWVySlMgc2NyaXB0XG4gIGluamVjdFNjcmlwdChcbiAgICBcImh0dHBzOi8vY2RuLmpzZGVsaXZyLm5ldC9ucG0vcGVlcmpzQDAuMy4yMC9kaXN0L3BlZXIubWluLmpzXCIsXG4gICAgb25Mb2FkZWRcbiAgKTtcbn1cblxuaWYgKGhhc1dpbmRvdykge1xuICBjb25zdCB1cmxQYXJhbXMgPSBuZXcgVVJMU2VhcmNoUGFyYW1zKHdpbmRvdy5sb2NhdGlvbi5zZWFyY2gpO1xuXG4gIC8vIEB0b2RvIFByb3ZpZGUgYSB3YXkgdG8gZGlzYWJsZSBpdCBpZiBuZWVkZWRcbiAgaWYgKHVybFBhcmFtcy5oYXMoXCJlbmFibGUtcmVtb3RlLWRldnRvb2xzXCIpKSB7XG4gICAgZW5hYmxlUmVtb3RlRGV2dG9vbHMoKTtcbiAgfVxufVxuIiwiaW1wb3J0IHsgVGFnQ29tcG9uZW50IH0gZnJvbSBcIi4uLy4uL3NyYy9pbmRleFwiO1xuXG5jbGFzcyBWZWN0b3IzIHtcbiAgY29uc3RydWN0b3IoeCA9IDAsIHkgPSAwLCB6ID0gMCkge1xuICAgIHRoaXMuc2V0KHgsIHksIHopO1xuICB9XG5cbiAgc2V0KHgsIHksIHopIHtcbiAgICB0aGlzLnggPSB4O1xuICAgIHRoaXMueSA9IHk7XG4gICAgdGhpcy56ID0gejtcbiAgfVxufVxuXG5leHBvcnQgY2xhc3MgVGFnQ29tcG9uZW50QSBleHRlbmRzIFRhZ0NvbXBvbmVudCB7fVxuZXhwb3J0IGNsYXNzIFRhZ0NvbXBvbmVudEIgZXh0ZW5kcyBUYWdDb21wb25lbnQge31cbmV4cG9ydCBjbGFzcyBUYWdDb21wb25lbnRDIGV4dGVuZHMgVGFnQ29tcG9uZW50IHt9XG5cbmV4cG9ydCBjbGFzcyBDb21wb25lbnQxIHtcbiAgY29uc3RydWN0b3IoKSB7XG4gICAgdGhpcy5hdHRyID0gMDtcbiAgfVxuXG4gIHJlc2V0KCkge1xuICAgIHRoaXMuYXR0ciA9IDA7XG4gIH1cbn1cblxuZXhwb3J0IGNsYXNzIENvbXBvbmVudDIge1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICB0aGlzLmF0dHIgPSAwO1xuICAgIHRoaXMuYXR0cjIgPSBcIlwiO1xuICB9XG5cbiAgcmVzZXQoKSB7XG4gICAgdGhpcy5hdHRyID0gMDtcbiAgICB0aGlzLmF0dHIyID0gXCJcIjtcbiAgfVxufVxuXG5leHBvcnQgY2xhc3MgQ29tcG9uZW50MyB7XG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIHRoaXMuYXR0ciA9IDA7XG4gICAgdGhpcy5hdHRyMiA9IDA7XG4gICAgdGhpcy5hdHRyMyA9IG5ldyBWZWN0b3IzKCk7XG4gIH1cblxuICByZXNldCgpIHtcbiAgICB0aGlzLmF0dHIgPSAwO1xuICAgIHRoaXMuYXR0cjIgPSBcIlwiO1xuICAgIHRoaXMuYXR0cjMuc2V0KDAsIDAsIDApO1xuICB9XG59XG5cbmV4cG9ydCBjbGFzcyBDb21wb25lbnQzTm9SZXNldCB7XG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIHRoaXMuYXR0ciA9IDA7XG4gICAgdGhpcy5hdHRyMiA9IDA7XG4gICAgdGhpcy5hdHRyMyA9IG5ldyBWZWN0b3IzKCk7XG4gIH1cbn1cblxuZXhwb3J0IGNsYXNzIEJhckNvbXBvbmVudCB7XG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIHRoaXMudmFyaWFibGVCYXIgPSAwO1xuICB9XG5cbiAgY29weShzcmMpIHtcbiAgICB0aGlzLnZhcmlhYmxlQmFyID0gc3JjLnZhcmlhYmxlQmFyO1xuICB9XG59XG5cbmV4cG9ydCBjbGFzcyBOb0NvcHlDb21wb25lbnQge1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICB0aGlzLnZhcmlhYmxlID0gMDtcbiAgfVxufVxuXG5leHBvcnQgY2xhc3MgRW1wdHlDb21wb25lbnQge31cbiIsImltcG9ydCB7IFdvcmxkIH0gZnJvbSBcIi4uL3NyYy9Xb3JsZC5qc1wiO1xuXG5leHBvcnQgZnVuY3Rpb24gaW5pdChiZW5jaG1hcmtzKSB7XG4gIGJlbmNobWFya3NcbiAgICAuZ3JvdXAoXCJ3b3JsZFwiKVxuICAgIC5hZGQoe1xuICAgICAgbmFtZTogXCJuZXcgV29ybGQoeyBlbnRpdHlQb29sU2l6ZTogMTAwayB9KVwiLFxuICAgICAgZXhlY3V0ZTogKCkgPT4ge1xuICAgICAgICBuZXcgV29ybGQoeyBlbnRpdHlQb29sU2l6ZTogMTAwMDAwIH0pO1xuICAgICAgfSxcbiAgICAgIGl0ZXJhdGlvbnM6IDEwXG4gICAgfSlcbiAgICAuYWRkKHtcbiAgICAgIG5hbWU6IFwiV29ybGQ6OmNyZWF0ZUVudGl0eSAoMTAwayBlbXB0eSwgcmVjcmVhdGluZyB3b3JsZClcIixcbiAgICAgIGV4ZWN1dGU6ICgpID0+IHtcbiAgICAgICAgbGV0IHdvcmxkID0gbmV3IFdvcmxkKCk7XG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgMTAwMDAwOyBpKyspIHtcbiAgICAgICAgICB3b3JsZC5jcmVhdGVFbnRpdHkoKTtcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIGl0ZXJhdGlvbnM6IDEwXG4gICAgfSlcbiAgICAuYWRkKHtcbiAgICAgIG5hbWU6XG4gICAgICAgIFwiV29ybGQ6OmNyZWF0ZUVudGl0eSAoMTAwayBlbXB0eSwgcmVjcmVhdGluZyB3b3JsZCAocG9vbFNpemU6IDEwMGspKVwiLFxuICAgICAgZXhlY3V0ZTogKCkgPT4ge1xuICAgICAgICBsZXQgd29ybGQgPSBuZXcgV29ybGQoeyBlbnRpdHlQb29sU2l6ZTogMTAwMDAwIH0pO1xuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IDEwMDAwMDsgaSsrKSB7XG4gICAgICAgICAgd29ybGQuY3JlYXRlRW50aXR5KCk7XG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICBpdGVyYXRpb25zOiAxMFxuICAgIH0pXG4gICAgLmFkZCh7XG4gICAgICBuYW1lOlxuICAgICAgICBcIldvcmxkOjpjcmVhdGVFbnRpdHkgKDEwMGsgZW1wdHksIHJlY3JlYXRpbmcgd29ybGQgKG5vdCBtZWFzdXJlZCksIGVudGl0eVBvb2xTaXplID0gMTAwaylcIixcbiAgICAgIHByZXBhcmU6IGN0eCA9PiB7XG4gICAgICAgIGN0eC53b3JsZCA9IG5ldyBXb3JsZCh7IGVudGl0eVBvb2xTaXplOiAxMDAwMDAgfSk7XG4gICAgICB9LFxuICAgICAgZXhlY3V0ZTogY3R4ID0+IHtcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCAxMDAwMDA7IGkrKykge1xuICAgICAgICAgIGN0eC53b3JsZC5jcmVhdGVFbnRpdHkoKTtcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIGl0ZXJhdGlvbnM6IDEwXG4gICAgfSlcbiAgICAuYWRkKHtcbiAgICAgIG5hbWU6XG4gICAgICAgIFwiV29ybGQ6OmNyZWF0ZUVudGl0eShuYW1lKSAoMTAwayBlbXB0eSwgcmVjcmVhdGluZyB3b3JsZCAobm90IG1lYXN1cmVkKSwgZW50aXR5UG9vbFNpemUgPSAxMDBrKVwiLFxuICAgICAgcHJlcGFyZTogY3R4ID0+IHtcbiAgICAgICAgY3R4LndvcmxkID0gbmV3IFdvcmxkKHsgZW50aXR5UG9vbFNpemU6IDEwMDAwMCB9KTtcbiAgICAgIH0sXG4gICAgICBleGVjdXRlOiBjdHggPT4ge1xuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IDEwMDAwMDsgaSsrKSB7XG4gICAgICAgICAgY3R4LndvcmxkLmNyZWF0ZUVudGl0eShcIm5hbWVcIiArIGkpO1xuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgaXRlcmF0aW9uczogMTBcbiAgICB9KVxuICAgIC5hZGQoe1xuICAgICAgbmFtZTpcbiAgICAgICAgXCJXb3JsZDo6Y3JlYXRlRW50aXR5ICgxMDBrIGVtcHR5LCByZXVzZSB3b3JsZCwgZW50aXR5UG9vbFNpemUgPSAxMDBrICogMTApXCIsXG4gICAgICBwcmVwYXJlR2xvYmFsOiBjdHggPT4ge1xuICAgICAgICBjdHgud29ybGQgPSBuZXcgV29ybGQoeyBlbnRpdHlQb29sU2l6ZTogMTAwMDAwICogMTAgfSk7XG4gICAgICB9LFxuICAgICAgZXhlY3V0ZTogY3R4ID0+IHtcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCAxMDAwMDA7IGkrKykge1xuICAgICAgICAgIGN0eC53b3JsZC5jcmVhdGVFbnRpdHkoKTtcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIGl0ZXJhdGlvbnM6IDEwXG4gICAgfSk7XG59XG4iLCJpbXBvcnQgT2JqZWN0UG9vbCBmcm9tIFwiLi4vc3JjL09iamVjdFBvb2wuanNcIjtcbmltcG9ydCB7IFRhZ0NvbXBvbmVudEEsIENvbXBvbmVudDMgfSBmcm9tIFwiLi9oZWxwZXJzL2NvbXBvbmVudHMuanNcIjtcblxuZXhwb3J0IGZ1bmN0aW9uIGluaXQoYmVuY2htYXJrcykge1xuICBiZW5jaG1hcmtzXG4gICAgLmdyb3VwKFwib2JqZWN0cG9vbFwiKVxuICAgIC5hZGQoe1xuICAgICAgbmFtZTogXCJuZXcgT2JqZWN0UG9vbChUYWdDb21wb25lbnQsIDEwMGspXCIsXG4gICAgICBleGVjdXRlOiAoKSA9PiB7XG4gICAgICAgIG5ldyBPYmplY3RQb29sKFRhZ0NvbXBvbmVudEEsIDEwMDAwMCk7XG4gICAgICB9XG4gICAgfSlcbiAgICAuYWRkKHtcbiAgICAgIG5hbWU6IFwibmV3IE9iamVjdFBvb2woQ29tcG9uZW50MSwgMTAwaylcIixcbiAgICAgIGV4ZWN1dGU6ICgpID0+IHtcbiAgICAgICAgbmV3IE9iamVjdFBvb2woQ29tcG9uZW50MywgMTAwMDAwKTtcbiAgICAgIH1cbiAgICB9KVxuICAgIC5hZGQoe1xuICAgICAgbmFtZTogXCJhY3F1aXJpbmcgMTAway4gT2JqZWN0UG9vbChDb21wb25lbnQxLCAxMDBrKVwiLFxuICAgICAgcHJlcGFyZTogY3R4ID0+IHtcbiAgICAgICAgY3R4LnBvb2wgPSBuZXcgT2JqZWN0UG9vbChDb21wb25lbnQzLCAxMDAwMDApO1xuICAgICAgfSxcbiAgICAgIGV4ZWN1dGU6IGN0eCA9PiB7XG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgMTAwMDAwOyBpKyspIHtcbiAgICAgICAgICBjdHgucG9vbC5hY3F1aXJlKCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KVxuICAgIC5hZGQoe1xuICAgICAgbmFtZTogXCJhY3F1aXJpbmcgMTAway4gT2JqZWN0UG9vbChDb21wb25lbnQxKVwiLFxuICAgICAgcHJlcGFyZTogY3R4ID0+IHtcbiAgICAgICAgY3R4LnBvb2wgPSBuZXcgT2JqZWN0UG9vbChDb21wb25lbnQzKTtcbiAgICAgIH0sXG4gICAgICBleGVjdXRlOiBjdHggPT4ge1xuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IDEwMDAwMDsgaSsrKSB7XG4gICAgICAgICAgY3R4LnBvb2wuYWNxdWlyZSgpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSlcbiAgICAuYWRkKHtcbiAgICAgIG5hbWU6IFwicmV0dXJuaW5nIDEwMGsuIE9iamVjdFBvb2woQ29tcG9uZW50MSlcIixcbiAgICAgIHByZXBhcmU6IGN0eCA9PiB7XG4gICAgICAgIGN0eC5wb29sID0gbmV3IE9iamVjdFBvb2woQ29tcG9uZW50Myk7XG4gICAgICAgIGN0eC5jb21wb25lbnRzID0gW107XG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgMTAwMDAwOyBpKyspIHtcbiAgICAgICAgICBjdHguY29tcG9uZW50cy5wdXNoKGN0eC5wb29sLmFjcXVpcmUoKSk7XG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICBleGVjdXRlOiBjdHggPT4ge1xuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IDEwMDAwMDsgaSsrKSB7XG4gICAgICAgICAgY3R4LnBvb2wucmVsZWFzZShjdHguY29tcG9uZW50c1tpXSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KTtcbn1cbiIsImltcG9ydCB7IEJlbmNobWFya3MgfSBmcm9tIFwiYmVuY2htYXJrZXItanNcIjtcbmltcG9ydCB7IGluaXQgYXMgaW5pdEVudGl0aWVzIH0gZnJvbSBcIi4vZW50aXRpZXMuYmVuY2guanNcIjtcbmltcG9ydCB7IGluaXQgYXMgaW5pdFdvcmxkIH0gZnJvbSBcIi4vd29ybGQuYmVuY2guanNcIjtcbmltcG9ydCB7IGluaXQgYXMgaW5pdFBvb2wgfSBmcm9tIFwiLi9vYmplY3Rwb29sLmJlbmNoLmpzXCI7XG5pbXBvcnQgeyBpbml0IGFzIGluaXRDb21wb25lbnRzIH0gZnJvbSBcIi4vY29tcG9uZW50cy5iZW5jaC5qc1wiO1xuXG5jb25zdCBkaXYgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChcInJlc3VsdHNcIik7XG5cbmxldCBjdXJyZW50VGFibGUgPSBudWxsO1xubGV0IGN1cnJlbnRHcm91cCA9IG51bGw7XG5cbmZ1bmN0aW9uIG9uR3JvdXBTdGFydChncm91cE5hbWUpIHtcbiAgdmFyIHRpdGxlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgdGl0bGUuc2V0QXR0cmlidXRlKFwiY2xhc3NcIiwgXCJ0YWJsZS10aXRsZVwiKTtcbiAgdGl0bGUuaW5uZXJIVE1MID0gYDxoMz4ke2dyb3VwTmFtZX08L2gzPmA7XG4gIGRpdi5hcHBlbmRDaGlsZCh0aXRsZSk7XG5cbiAgY3VycmVudFRhYmxlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInRhYmxlXCIpO1xuICBjdXJyZW50VGFibGUuc2V0QXR0cmlidXRlKFwiY2xhc3NcIiwgXCJ0YWJsZS1maWxsXCIpO1xuXG4gIGxldCBoZWFkQ2VsbHMgPSBbXG4gICAgXCJiZW5jaG1hcmtcIixcbiAgICBcIml0ZXJhdGlvbnNcIixcbiAgICBcIm1pblwiLFxuICAgIFwibWF4XCIsXG4gICAgXCJzdW1cIixcbiAgICBcIm1lYW5cIixcbiAgICBcInZhcmlhbmNlXCIsXG4gICAgXCJzdGRfZGV2aWF0aW9uXCJcbiAgXVxuICAgIC5tYXAobmFtZSA9PiBgPHRoPiR7bmFtZX08L3RoPmApXG4gICAgLmpvaW4oXCJcIik7XG5cbiAgY3VycmVudFRhYmxlLmlubmVySFRNTCA9IGA8dGhlYWQ+XG4gIDx0cj5cbiAgICAke2hlYWRDZWxsc31cbiAgPC90cj5cbiAgPC90aGVhZD48dGJvZHk+PC90Ym9keT5gO1xuICBkaXYuYXBwZW5kQ2hpbGQoY3VycmVudFRhYmxlKTtcblxuICBjdXJyZW50R3JvdXAgPSBncm91cE5hbWU7XG59XG5cbmZ1bmN0aW9uIG9uQmVuY2htYXJrRmluaXNoZWQoYmVuY2gpIHtcbiAgaWYgKGN1cnJlbnRHcm91cCAhPT0gYmVuY2guZ3JvdXBOYW1lKSB7XG4gICAgb25Hcm91cFN0YXJ0KGJlbmNoLmdyb3VwTmFtZSk7XG4gIH1cblxuICBjb25zdCB2YWx1ZXMgPSBiZW5jaC5zdGF0cy5nZXRBbGwoKTtcblxuICBjb25zdCB0Ym9keSA9IGN1cnJlbnRUYWJsZS5xdWVyeVNlbGVjdG9yKFwidGJvZHlcIik7XG5cbiAgbGV0IHJvd0h0bWwgPSBgPHRkPiR7YmVuY2gubmFtZX08L3RkPjx0ZD4ke2JlbmNoLml0ZXJhdGlvbnN9PC90ZD5gO1xuXG4gIGNvbnN0IHRvRml4ZWQgPSBbXCJtZWFuXCIsIFwidmFyaWFuY2VcIiwgXCJzdGFuZGFyZF9kZXZpYXRpb25cIl07XG4gIE9iamVjdC5lbnRyaWVzKHZhbHVlcykuZm9yRWFjaCgoW2tleSwgdmFsdWVdKSA9PiB7XG4gICAgaWYgKGtleSAhPT0gXCJuXCIpIHtcbiAgICAgIGlmICh0b0ZpeGVkLmluZGV4T2Yoa2V5KSAhPT0gLTEpIHtcbiAgICAgICAgdmFsdWUgPSB2YWx1ZS50b0ZpeGVkKDIpO1xuICAgICAgfVxuICAgICAgcm93SHRtbCArPSBgPHRkPiR7dmFsdWV9PC90ZD5gO1xuICAgIH1cbiAgfSk7XG5cbiAgbGV0IHJvdyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJ0clwiKTtcbiAgcm93LmlubmVySFRNTCA9IHJvd0h0bWw7XG4gIHRib2R5LmFwcGVuZENoaWxkKHJvdyk7XG59XG5cbmxldCBiZW5jaG1hcmtzID0gbmV3IEJlbmNobWFya3Moe1xuICAvLyAgdmVyYm9zZTogdHJ1ZSxcbiAgc3VtbWFyeTogdHJ1ZSxcbiAgaXRlcmF0aW9uczogMTAsXG4gIG9uQmVuY2htYXJrRmluaXNoZWQ6IG9uQmVuY2htYXJrRmluaXNoZWRcbn0pO1xuXG5pbml0V29ybGQoYmVuY2htYXJrcyk7XG4vL2luaXRFbnRpdGllcyhiZW5jaG1hcmtzKTtcbmluaXRQb29sKGJlbmNobWFya3MpO1xuLy9pbml0Q29tcG9uZW50cyhiZW5jaG1hcmtzKTtcbmJlbmNobWFya3MucnVuKCk7XG5cbmNvbnNvbGUubG9nKGJlbmNobWFya3MuZ2V0UmVwb3J0KFwianNvblwiKSk7XG4iXSwibmFtZXMiOlsiU3RhdHMiLCJERUZBVUxUX09QVElPTlMiLCJpbml0IiwiaW5pdFdvcmxkIiwiaW5pdFBvb2wiXSwibWFwcGluZ3MiOiJBQUVlLE1BQU0sU0FBUyxDQUFDO0FBQy9CLEVBQUUsV0FBVyxHQUFHO0FBQ2hCLElBQUksSUFBSSxDQUFDLENB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
