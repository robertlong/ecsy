<<<<<<< HEAD
import { World } from "../src/World.js";
import { Component3 } from "./helpers/components.js";

export function init(benchmarks) {
  benchmarks
    .group("components")
    .add({
      name: "Entity::addComponent(Component3)",
      prepare: ctx => {
        ctx.world = new World();
        ctx.world.registerComponent(Component3);
=======
import { World } from "../src";
import { Component3, Component3NoReset } from "./helpers/components.js";

export function init(benchmarks) {
  benchmarks
    .add({
      name: "Entity::addComponent(Component3NoReset)",
      prepare: ctx => {
        ctx.world = new World();
>>>>>>> More benchmarks
        for (let i = 0; i < 100000; i++) {
          ctx.world.createEntity();
        }
      },
      execute: ctx => {
        for (let i = 0; i < 100000; i++) {
<<<<<<< HEAD
          ctx.world.entityManager._entities[i].addComponent(Component3);
        }
      }
    })
    .add({
      name: "Entity::addComponent(Component3)",
      prepare: ctx => {
        ctx.world = new World();
        ctx.world.registerComponent(Component3);
=======
          ctx.world.entityManager._entities[i].addComponent(Component3NoReset);
        }
      },
      iterations: 10
    })
    .add({
      name: "Entity::addComponent(Component3NoReset)",
      prepare: ctx => {
        ctx.world = new World();
>>>>>>> More benchmarks
        for (let i = 0; i < 100000; i++) {
          ctx.world.createEntity();
        }
      },
      execute: ctx => {
        for (let i = 0; i < 100000; i++) {
<<<<<<< HEAD
          ctx.world.entityManager._entities[i].addComponent(Component3);
        }
      }
    })
    .add({
      name: "Entity::removeComponent(Component3)",
      prepare: ctx => {
        ctx.world = new World();
        ctx.world.registerComponent(Component3);
        for (let i = 0; i < 100000; i++) {
          ctx.world.createEntity().addComponent(Component3);
=======
          ctx.world.entityManager._entities[i].addComponent(Component3NoReset);
        }
      },
      iterations: 10
    })
    .add({
      name: "Entity::removeComponent(Component3NoReset)",
      prepare: ctx => {
        ctx.world = new World();
        for (let i = 0; i < 100000; i++) {
          ctx.world.createEntity().addComponent(Component3NoReset);
>>>>>>> More benchmarks
        }
      },
      execute: ctx => {
        for (let i = 0; i < 100000; i++) {
          ctx.world.entityManager._entities[i].removeComponent(
<<<<<<< HEAD
            Component3
          );
        }
      }
    })
    .add({
      name: "Entity::removeComponent(Component3)",
      prepare: ctx => {
        ctx.world = new World();
        ctx.world.registerComponent(Component3);
        for (let i = 0; i < 100000; i++) {
          ctx.world.createEntity().addComponent(Component3);
=======
            Component3NoReset
          );
        }
      },
      iterations: 10
    })
    .add({
      name: "Entity::removeComponent(Component3NoReset)",
      prepare: ctx => {
        ctx.world = new World();
        for (let i = 0; i < 100000; i++) {
          ctx.world.createEntity().addComponent(Component3NoReset);
>>>>>>> More benchmarks
        }
      },
      execute: ctx => {
        for (let i = 0; i < 100000; i++) {
          ctx.world.entityManager._entities[i].removeComponent(
<<<<<<< HEAD
            Component3
          );
        }
      }
    })
    .add({
      name: "Entity::removeComponent(Component3) sync",
      prepare: ctx => {
        ctx.world = new World();
        ctx.world.registerComponent(Component3);
        for (let i = 0; i < 100000; i++) {
          ctx.world.createEntity().addComponent(Component3);
=======
            Component3NoReset
          );
        }
      },
      iterations: 10
    })
    .add({
      name: "Entity::removeComponent(Component3NoReset) sync",
      prepare: ctx => {
        ctx.world = new World();
        for (let i = 0; i < 100000; i++) {
          ctx.world.createEntity().addComponent(Component3NoReset);
>>>>>>> More benchmarks
        }
      },
      execute: ctx => {
        for (let i = 0; i < 100000; i++) {
          ctx.world.entityManager._entities[i].removeComponent(
<<<<<<< HEAD
            Component3,
            true
          );
        }
      }
    })
    .add({
      name: "Entity::removeComponent(Component3) sync",
      prepare: ctx => {
        ctx.world = new World();
        ctx.world.registerComponent(Component3);
        for (let i = 0; i < 100000; i++) {
          ctx.world.createEntity().addComponent(Component3);
=======
            Component3NoReset,
            true
          );
        }
      },
      iterations: 10
    })
    .add({
      name: "Entity::removeComponent(Component3NoReset) sync",
      prepare: ctx => {
        ctx.world = new World();
        for (let i = 0; i < 100000; i++) {
          ctx.world.createEntity().addComponent(Component3NoReset);
>>>>>>> More benchmarks
        }
      },
      execute: ctx => {
        for (let i = 0; i < 100000; i++) {
          ctx.world.entityManager._entities[i].removeComponent(
<<<<<<< HEAD
            Component3,
            true
          );
        }
      }
=======
            Component3NoReset,
            true
          );
        }
      },
      iterations: 10
>>>>>>> More benchmarks
    });

  /*
    .add({
      name: "Entity::addComponent(Component3) poolsize = entities",
      prepare: ctx => {
        ctx.world = new World();
        for (let i = 0; i < 100000; i++) {
          ctx.world.createEntity();
        }
      },
      execute: ctx => {
        for (let i = 0; i < 100000; i++) {
          ctx.world.entityManager._entities[i].addComponent(Component3);
        }
<<<<<<< HEAD
      }
=======
      },
      iterations: 10
>>>>>>> More benchmarks
    });
    */
}
