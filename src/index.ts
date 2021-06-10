#!/usr/bin/env node

import { Command } from "commander";
import { readFile, access, rename, unlink } from "fs";
import Listr from "listr";
import { z } from "zod";
import { dirname, resolve as pathResolve } from "path";
import execa from "execa";

const manifestSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  version: z
    .string()
    .regex(
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/,
      "Version must be a valid semver version number, e.g. `1.0.0`."
    ),
  author: z.string().min(1).max(100),
  main: z.string().min(1).max(100),
  dev: z.string().min(1).max(100).optional(),
  remote: z.string().min(1).max(100).optional(),
  icon: z.string().min(1).max(100).optional(),
  remoteIcon: z.string().min(1).max(100).optional(),
  settings: z
    .record(
      z.object({
        label: z.string().min(1).max(100),
        type: z.enum(["text", "password", "status", "button"]),
        required: z.boolean().optional(),
        fallback: z.string().min(1).max(1024).optional(),
      })
    )
    .optional(),
});

interface TaskContext {
  manifestPath: string;
  manifestData?: string;
  manifest?: z.infer<typeof manifestSchema>;
}

const packagePlugin = (args: any) => {
  let manifestPath = "./plugin.json";

  if (typeof args?.manifest === "string" && args.manifest) {
    manifestPath = args.manifest;
  }

  const tasks = new Listr([
    {
      title: "Finding plugin manifest",
      task: async (ctx: TaskContext) => {
        ctx.manifestData = await new Promise<string>(
          (resolve, reject) =>
            void readFile(
              ctx.manifestPath,
              { encoding: "utf-8" },
              (err, data) => (err ? reject(err) : resolve(data))
            )
        );
      },
    },
    {
      title: "Verifying manifest shape",
      task: (ctx: TaskContext) => {
        if (!ctx.manifestData)
          throw new Error("Failed to collect manifest data from previous task");

        const manifestJson = JSON.parse(ctx.manifestData);
        ctx.manifest = manifestSchema.parse(manifestJson);
      },
    },
    {
      title: "Verifying manifest targets",
      task: async (ctx: TaskContext) => {
        if (!ctx.manifest)
          throw new Error("Could not find manifest to verify targets");

        const subTasks: Promise<unknown>[] = [];
        const rootPath = dirname(pathResolve(ctx.manifestPath));

        const mainPath = pathResolve(rootPath, ctx.manifest.main);

        subTasks.push(
          new Promise<void>((resolve, reject) => {
            access(mainPath, (err) => {
              if (err) {
                reject(err);
              } else {
                resolve();
              }
            });
          })
        );

        /**
         * Verify that `icon` exists
         */
        if (ctx.manifest.icon) {
          const iconPath = pathResolve(rootPath, ctx.manifest.icon);

          subTasks.push(
            new Promise<void>((resolve, reject) => {
              access(iconPath, (err) => {
                if (err) {
                  reject(err);
                } else {
                  resolve();
                }
              });
            })
          );
        }

        await Promise.all(subTasks);
      },
    },
    {
      title: "Package",
      task: async () => {
        await execa("npm", ["pack"]);
      },
    },
    {
      title: "Finalising",
      task: async (ctx: TaskContext) => {
        if (!ctx.manifest)
          throw new Error("Failed to access manifest data for finalising");

        const baseName = [ctx.manifest.id, ctx.manifest.version].join("-");
        const expectedName = `${baseName}.tgz`;
        const targetName = `${baseName}.midiMixerPlugin`;

        /**
         * Remove previous `.midiMixerPlugin` file if found.
         */
        await new Promise<void>((resolve, reject) => {
          unlink(targetName, (err) => {
            if (err && err.code !== "ENOENT") {
              reject(err);
            } else {
              resolve();
            }
          });
        });

        await new Promise<void>((resolve, reject) => {
          rename(expectedName, targetName, (err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        });
      },
    },
  ]);

  tasks
    .run({
      manifestPath,
    })
    .catch(console.error);
};

const program = new Command();

program
  .version("1.0.0")
  .description(
    "A CLI tool to help with the packaging and distribution of MIDI Mixer plugins."
  );

program
  .command("pack")
  .description("Package a plugin ready for distribution.")
  .option("-m --manifest <path>", "target plugin.json file")
  .action(packagePlugin);

program.parse(process.argv);
