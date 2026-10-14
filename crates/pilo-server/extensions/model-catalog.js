const EXTENDED_THINKING_LEVELS = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
];

function supportedThinkingLevels(model) {
	if (!model.reasoning) return ["off"];
	const map = model.thinkingLevelMap;
	return EXTENDED_THINKING_LEVELS.filter((level) => {
		const mapped = map ? map[level] : undefined;
		if (mapped === null) return false;
		if (level === "xhigh" || level === "max") return mapped !== undefined;
		return true;
	});
}

function modelKey(model) {
	return model ? model.provider + "\u0000" + model.id : null;
}

export default function (pi) {
	pi.registerCommand("pilo_model_catalog", {
		description: "Pilo model catalog probe",
		handler: async (_args, ctx) => {
			try {
				const models = ctx.modelRegistry.getAvailable();
				const baselineModel = ctx.model;
				const baselineThinkingLevel = ctx.thinkingLevel;
				const defaults = new Map();
				if (baselineModel) {
					/* eslint-disable no-await-in-loop -- Model selection mutates one Pi session; defaults must be resolved serially from the restored baseline. */
					for (const model of models) {
						try {
							await pi.setModel(baselineModel);
							pi.setThinkingLevel(baselineThinkingLevel);
							if (modelKey(model) !== modelKey(baselineModel)) {
								await pi.setModel(model);
							}
							defaults.set(modelKey(model), pi.getThinkingLevel());
						} catch {
							// Leave the default unresolved; Pilo falls back per model.
						}
					}
					/* eslint-enable no-await-in-loop */
					try {
						await pi.setModel(baselineModel);
						pi.setThinkingLevel(baselineThinkingLevel);
					} catch {
						// Best-effort restore on a throwaway probe session.
					}
				}
				const scoped = Array.isArray(ctx.scopedModels) ? ctx.scopedModels : [];
				const scopedKeys = scoped.map((entry) => modelKey(entry.model));
				const baselineIndex = scopedKeys.indexOf(modelKey(baselineModel));
				const orderedKeys =
					baselineIndex > 0
						? scopedKeys
								.slice(baselineIndex)
								.concat(scopedKeys.slice(0, baselineIndex))
						: scopedKeys;
				const catalog = models.map((model) => {
					const key = modelKey(model);
					const scopedIndex = orderedKeys.indexOf(key);
					const scopedEntry =
						scopedIndex === -1 ? null : scoped[scopedKeys.indexOf(key)];
					return Object.assign({}, model, {
						thinkingLevels: supportedThinkingLevels(model),
						defaultThinkingLevel: defaults.has(key) ? defaults.get(key) : null,
						scopeOrder: scopedIndex === -1 ? null : scopedIndex,
						scopeThinkingLevel:
							scopedEntry && scopedEntry.thinkingLevel !== undefined
								? scopedEntry.thinkingLevel
								: null,
					});
				});
				await ctx.ui.confirm(
					"pilo-model-catalog:v1",
					JSON.stringify({
						models: catalog,
						baselineModel,
						baselineThinkingLevel,
					}),
				);
			} catch (error) {
				await ctx.ui.confirm(
					"pilo-model-catalog:error",
					String(error && error.message ? error.message : error),
				);
			}
		},
	});
}
