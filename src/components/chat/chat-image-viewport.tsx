import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Minus, Plus } from "lucide-react";

const MAX_SCALE = 5;
const CONTROL_CLASS =
	"inline-flex min-w-11 min-h-11 items-center justify-center rounded-md px-3 text-white/80 hover:bg-white/15 hover:text-white disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-ring";

type Point = { x: number; y: number };
type ImageTransform = Point & { scale: number };

export function ChatImageViewport({
	url,
	name,
	onClose,
}: {
	url: string;
	name: string;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const viewportRef = useRef<HTMLElement>(null);
	const imageRef = useRef<HTMLImageElement>(null);
	const [transform, setTransform] = useState<ImageTransform>({
		x: 0,
		y: 0,
		scale: 1,
	});
	const transformRef = useRef(transform);
	const pointersRef = useRef(new Map<number, Point>());
	const gestureRef = useRef({ x: 0, y: 0, moved: false, background: false });

	const applyTransform = useCallback((next: ImageTransform) => {
		const viewport = viewportRef.current;
		const image = imageRef.current;
		if (!viewport || !image) return;
		const scale = Math.max(1, Math.min(MAX_SCALE, next.scale));
		const maxX = Math.max(
			0,
			(image.offsetWidth * scale - viewport.clientWidth) / 2,
		);
		const maxY = Math.max(
			0,
			(image.offsetHeight * scale - viewport.clientHeight) / 2,
		);
		const value = {
			scale,
			x: Math.max(-maxX, Math.min(maxX, next.x)),
			y: Math.max(-maxY, Math.min(maxY, next.y)),
		};
		transformRef.current = value;
		setTransform(value);
	}, []);

	const zoom = useCallback(
		(factor: number) => {
			const current = transformRef.current;
			const scale = Math.max(1, Math.min(MAX_SCALE, current.scale * factor));
			applyTransform({
				scale,
				x: current.x * (scale / current.scale),
				y: current.y * (scale / current.scale),
			});
		},
		[applyTransform],
	);

	useEffect(() => {
		const viewport = viewportRef.current;
		if (!viewport) return;
		const handleWheel = (event: WheelEvent) => {
			if (!event.ctrlKey) return;
			event.preventDefault();
			const unit =
				event.deltaMode === WheelEvent.DOM_DELTA_LINE
					? 16
					: event.deltaMode === WheelEvent.DOM_DELTA_PAGE
						? viewport.clientHeight
						: 1;
			zoom(Math.exp(-event.deltaY * unit * 0.002));
		};
		// React wheel listeners are passive and cannot prevent page zoom.
		viewport.addEventListener("wheel", handleWheel, { passive: false });
		return () => viewport.removeEventListener("wheel", handleWheel);
	}, [zoom]);

	useEffect(() => {
		const viewport = viewportRef.current;
		const image = imageRef.current;
		if (!viewport || !image) return;
		const observer = new ResizeObserver(() =>
			applyTransform(transformRef.current),
		);
		observer.observe(viewport);
		observer.observe(image);
		return () => observer.disconnect();
	}, [applyTransform]);

	return (
		<>
			{/* oxlint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- The image region is focusable for keyboard zoom/pan; Escape closes via Dialog. */}
			<section
				ref={viewportRef}
				aria-label={name}
				tabIndex={0}
				className="flex min-h-0 flex-1 touch-none select-none items-center justify-center overflow-hidden rounded-md focus-visible:outline-2 focus-visible:outline-ring [-webkit-touch-callout:none]"
				onKeyDown={(event) => {
					if (event.ctrlKey || event.metaKey || event.altKey) return;
					const current = transformRef.current;
					switch (event.key) {
						case "+":
						case "=":
							zoom(1.5);
							break;
						case "-":
							zoom(1 / 1.5);
							break;
						case "0":
							applyTransform({ x: 0, y: 0, scale: 1 });
							break;
						case "ArrowLeft":
							applyTransform({ ...current, x: current.x + 50 });
							break;
						case "ArrowRight":
							applyTransform({ ...current, x: current.x - 50 });
							break;
						case "ArrowUp":
							applyTransform({ ...current, y: current.y + 50 });
							break;
						case "ArrowDown":
							applyTransform({ ...current, y: current.y - 50 });
							break;
						default:
							return;
					}
					event.preventDefault();
				}}
				onPointerDown={(event) => {
					if (event.button !== 0 || pointersRef.current.size >= 2) return;
					if (pointersRef.current.size === 0) {
						gestureRef.current = {
							x: event.clientX,
							y: event.clientY,
							moved: false,
							background: event.target === event.currentTarget,
						};
					} else {
						gestureRef.current.moved = true;
					}
					pointersRef.current.set(event.pointerId, {
						x: event.clientX,
						y: event.clientY,
					});
					event.currentTarget.setPointerCapture(event.pointerId);
				}}
				onPointerMove={(event) => {
					const pointers = pointersRef.current;
					const previous = pointers.get(event.pointerId);
					if (!previous) return;
					const before = [...pointers.values()];
					const point = { x: event.clientX, y: event.clientY };
					pointers.set(event.pointerId, point);
					const gesture = gestureRef.current;
					if (Math.hypot(point.x - gesture.x, point.y - gesture.y) > 4)
						gesture.moved = true;
					const current = transformRef.current;
					const [first, second] = [...pointers.values()];
					if (second) {
						const [oldFirst, oldSecond] = before;
						const distance = Math.hypot(
							oldFirst.x - oldSecond.x,
							oldFirst.y - oldSecond.y,
						);
						if (distance === 0) return;
						const scale = Math.max(
							1,
							Math.min(
								MAX_SCALE,
								current.scale *
									(Math.hypot(first.x - second.x, first.y - second.y) /
										distance),
							),
						);
						const rect = event.currentTarget.getBoundingClientRect();
						const oldX =
							(oldFirst.x + oldSecond.x) / 2 - rect.left - rect.width / 2;
						const oldY =
							(oldFirst.y + oldSecond.y) / 2 - rect.top - rect.height / 2;
						const x = (first.x + second.x) / 2 - rect.left - rect.width / 2;
						const y = (first.y + second.y) / 2 - rect.top - rect.height / 2;
						applyTransform({
							scale,
							x: x - (oldX - current.x) * (scale / current.scale),
							y: y - (oldY - current.y) * (scale / current.scale),
						});
					} else if (current.scale > 1) {
						applyTransform({
							...current,
							x: current.x + point.x - previous.x,
							y: current.y + point.y - previous.y,
						});
					}
				}}
				onPointerUp={(event) => pointersRef.current.delete(event.pointerId)}
				onPointerCancel={(event) => {
					pointersRef.current.delete(event.pointerId);
					gestureRef.current.moved = true;
				}}
				onLostPointerCapture={(event) =>
					pointersRef.current.delete(event.pointerId)
				}
				onClick={(event) => {
					// Pointer capture retargets clicks; only an unmoved background tap closes.
					if (
						!gestureRef.current.moved &&
						gestureRef.current.background &&
						event.target === event.currentTarget
					)
						onClose();
				}}
			>
				<DialogPrimitive.Description asChild>
					<img
						ref={imageRef}
						src={url}
						alt={name}
						draggable={false}
						decoding="async"
						className="max-h-full max-w-full shrink-0 select-none rounded-md object-contain shadow-2xl"
						style={{
							transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
						}}
					/>
				</DialogPrimitive.Description>
			</section>
			{/* oxlint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
			<div className="flex shrink-0 items-center justify-center gap-1 pt-2">
				<button
					type="button"
					className={CONTROL_CLASS}
					aria-label={t("chat.zoomOutImage")}
					disabled={transform.scale <= 1}
					onClick={() => zoom(1 / 1.5)}
				>
					<Minus className="size-4" aria-hidden="true" />
				</button>
				<button
					type="button"
					className={CONTROL_CLASS}
					aria-label={t("chat.resetImageZoom", {
						percent: Math.round(transform.scale * 100),
					})}
					onClick={() => applyTransform({ x: 0, y: 0, scale: 1 })}
				>
					<span className="text-xs tabular-nums">
						{Math.round(transform.scale * 100)}%
					</span>
				</button>
				<button
					type="button"
					className={CONTROL_CLASS}
					aria-label={t("chat.zoomInImage")}
					disabled={transform.scale >= MAX_SCALE}
					onClick={() => zoom(1.5)}
				>
					<Plus className="size-4" aria-hidden="true" />
				</button>
			</div>
		</>
	);
}
