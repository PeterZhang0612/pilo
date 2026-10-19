import assert from "node:assert/strict";
import test from "node:test";

import {
	findMatchingPiModel,
	getNextPiQuickCycleModel,
	getPiModelThinkingLevels,
	getPiQuickCycleModels,
	getPiQuickCycleThinkingLevel,
} from "../../src/lib/pi-model-selection.ts";
import type { PiModel } from "../../src/lib/api/pi-runtime.ts";

function model(id: string, overrides: Partial<PiModel> = {}): PiModel {
	return {
		id,
		name: id,
		provider: "test",
		reasoning: true,
		...overrides,
	};
}

test("Pi quick cycle prefers scoped models in scope order", () => {
	const models = [
		model("outside", { scopeOrder: null }),
		model("second", { scopeOrder: 1 }),
		model("first", { scopeOrder: 0 }),
	];

	assert.deepEqual(
		getPiQuickCycleModels(models).map((item) => item.id),
		["first", "second"],
	);
	assert.equal(getNextPiQuickCycleModel(models, models[2])?.id, "second");
	assert.equal(getNextPiQuickCycleModel(models, models[1])?.id, "first");
});

test("Pi quick cycle falls back to all models when no scope is configured", () => {
	const models = [
		model("one", { scopeOrder: null }),
		model("two", { scopeOrder: null }),
	];

	assert.deepEqual(
		getPiQuickCycleModels(models).map((item) => item.id),
		["one", "two"],
	);
	assert.equal(getNextPiQuickCycleModel(models, models[0])?.id, "two");
});

test("Pi quick cycle uses the scoped thinking level when available", () => {
	const scoped = model("scoped", {
		scopeOrder: 0,
		scopeThinkingLevel: "high",
		defaultThinkingLevel: "low",
	});
	const regular = model("regular", {
		scopeOrder: null,
		defaultThinkingLevel: "medium",
	});

	assert.equal(getPiQuickCycleThinkingLevel(scoped), "high");
	assert.equal(getPiQuickCycleThinkingLevel(regular), "medium");
});

test("thinking levels expose only the selected model profile", () => {
	const restricted = model("restricted", {
		thinkingLevels: ["off", "low", "high"],
	});

	assert.deepEqual(getPiModelThinkingLevels(restricted), [
		"off",
		"low",
		"high",
	]);
	assert.deepEqual(getPiModelThinkingLevels(model("unknown")), []);
});

test("finding a model accepts a routing-prefixed alias of a catalog id", () => {
	const catalog = [
		model("deepseek-v4.1-flash", { contextWindow: 1_000_000 }),
		model("gemini-3.8-flash-high"),
	];

	assert.equal(
		findMatchingPiModel(catalog, {
			provider: "test",
			id: "cline-pass/deepseek-v4.1-flash",
		})?.id,
		"deepseek-v4.1-flash",
	);
	// 目录里是带前缀的写法、历史里是裸 id 时反过来也要认出来。
	assert.equal(
		findMatchingPiModel([model("cline-pass/gemini-3.8-flash-high")], {
			provider: "test",
			id: "gemini-3.8-flash-high",
		})?.id,
		"cline-pass/gemini-3.8-flash-high",
	);
});

test("finding a model never matches across providers", () => {
	const catalog = [model("deepseek-v4.1-flash", { provider: "other" })];

	assert.equal(
		findMatchingPiModel(catalog, {
			provider: "test",
			id: "cline-pass/deepseek-v4.1-flash",
		}),
		null,
	);
});

test("finding a model prefers the exact id over an alias", () => {
	const catalog = [
		model("cline-pass/deepseek-v4.1-flash", { name: "prefixed" }),
		model("deepseek-v4.1-flash", { name: "bare" }),
	];

	assert.equal(
		findMatchingPiModel(catalog, {
			provider: "test",
			id: "deepseek-v4.1-flash",
		})?.name,
		"bare",
	);
});
