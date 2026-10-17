import { useLayoutEffect, useState, type RefObject } from "react";

// 输入区不在滚动容器内，需要补上与滚动条 gutter 等宽的内边距才能和消息列左右对齐。
// 固定值在不同平台（overlay / thin / DPI 缩放）下并不一致，所以实测。
export function useScrollbarGutterWidth(
	ref: RefObject<HTMLElement | null>,
	enabled = true,
): number {
	const [gutterWidth, setGutterWidth] = useState(0);
	// 草稿/会话切换会替换滚动区，但 ref 对象不变，需在每次提交后重新绑定。
	useLayoutEffect(() => {
		if (!enabled) return;
		const viewport = ref.current;
		if (!viewport) return;
		let frame: number | null = null;
		const measure = () => {
			frame = null;
			const nextWidth = viewport.offsetWidth - viewport.clientWidth;
			setGutterWidth((currentWidth) =>
				currentWidth === nextWidth ? currentWidth : nextWidth,
			);
		};
		const scheduleMeasure = () => {
			if (frame !== null) return;
			frame = requestAnimationFrame(measure);
		};
		measure();
		const observer = new ResizeObserver(scheduleMeasure);
		observer.observe(viewport);
		return () => {
			observer.disconnect();
			if (frame !== null) cancelAnimationFrame(frame);
		};
	});
	return gutterWidth;
}
