#!/usr/bin/env node

import { Command } from "commander";
import execa from "execa";
import { access, readFile, rename, unlink, writeFile } from "fs";
import Listr from "listr";
import { dirname, resolve as pathResolve } from "path";
import { z } from "zod";

const versionSchema = z
  .string()
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/,
    "Version must be a valid semver version number, e.g. `1.0.0`."
  );

const packageSchema = z.object({
  name: z.string().min(1).max(100),
  version: versionSchema,
});

const commonManifestSettingsSchema = {
  label: z.string().min(1).max(100),
  required: z.boolean().optional(),
};

const manifestSchema = z.object({
  $schema: z.string().optional(),
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  type: z.string().optional(),
  version: versionSchema,
  author: z.string().min(1).max(100),
  main: z.string().min(1).max(100),
  dev: z.string().min(1).max(100).optional(),
  remote: z.string().min(1).max(100).optional(),
  icon: z.string().min(1).max(100).optional(),
  remoteIcon: z.string().min(1).max(100).optional(),
  settings: z
    .record(
      z.union([
        z.object({
          ...commonManifestSettingsSchema,
          type: z.enum(["text", "password", "status", "button"]),
          fallback: z.string().min(1).max(1024).optional(),
        }),
        z.object({
          ...commonManifestSettingsSchema,
          type: z.enum(["toggle"]),
          fallback: z.boolean().optional(),
        }),
        z.object({
          ...commonManifestSettingsSchema,
          type: z.enum(["integer", "slider"]),
          fallback: z.number().optional(),
          min: z.number(),
          max: z.number(),
        }),
      ])
    )
    .optional(),
});

interface TaskContext {
  maybePackagePath: string;
  maybePackageData?: string | null;
  manifestPath: string;
  manifestData?: string;
  manifest?: z.infer<typeof manifestSchema>;
}

const packagePlugin = (args: any) => {
  let manifestPath = "./plugin.json";
  const maybePackagePath = "./package.json";

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
      title: "Finding package.json",
      task: async (ctx: TaskContext) => {
        ctx.maybePackageData = await new Promise<string | null>(
          (resolve) =>
            void readFile(
              ctx.maybePackagePath,
              { encoding: "utf-8" },
              (err, data) => (err ? resolve(null) : resolve(data))
            )
        );
      },
    },
    {
      title: "Try sync plugin manifest with package.json",
      task: async (ctx: TaskContext) => {
        if (!ctx.manifest)
          throw new Error("Could not find manifest sync with package.json");

        if (typeof ctx.maybePackageData !== "string") {
          return;
        }

        const packageData = packageSchema.parse(
          JSON.parse(ctx.maybePackageData)
        );

        ctx.manifest.id = packageData.name;
        ctx.manifest.version = packageData.version;

        /**
         * Re-validate the manifest shape to confirm that it is valid.
         */
        manifestSchema.parse(ctx.manifest);

        /**
         * Write the new manifest to the manifest file.
         */
        await new Promise<void>(
          (resolve, reject) =>
            void writeFile(
              ctx.manifestPath,
              JSON.stringify(ctx.manifest, null, 2),
              { encoding: "utf-8" },
              (err) => (err ? reject(err) : resolve())
            )
        );
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
      maybePackagePath,
    })
    .catch(console.error);
};

const program = new Command();

program
  .name("midi-mixer")
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
