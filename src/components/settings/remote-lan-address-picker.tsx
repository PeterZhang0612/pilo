import { useState } from "react";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
	getRemoteLanAddresses,
	type RemoteAccessAddress,
} from "@/lib/api/remote";
import { remoteAddressConfig } from "@/lib/remote-addresses";
import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	Spinner,
} from "@/ui";

export function RemoteLanAddressPicker({
	port,
	addresses,
	disabled,
	onAdd,
}: {
	port: number;
	addresses: RemoteAccessAddress[];
	disabled: boolean;
	onAdd: (baseUrl: string) => void;
}) {
	const { t } = useTranslation();
	const [result, setResult] = useState<
		| { status: "loading" }
		| { status: "ready"; ips: string[] }
		| { status: "error"; message: string }
	>({ status: "loading" });

	const load = async () => {
		setResult({ status: "loading" });
		try {
			setResult({ status: "ready", ips: await getRemoteLanAddresses() });
		} catch (cause) {
			setResult({
				status: "error",
				message: cause instanceof Error ? cause.message : String(cause),
			});
		}
	};

	const existingOrigins = new Set(
		remoteAddressConfig(addresses, "").addresses.map((address) => {
			try {
				return new URL(address.baseUrl).origin;
			} catch {
				return null;
			}
		}),
	);

	return (
		<DropdownMenu
			onOpenChange={(open) => {
				if (open) void load();
			}}
		>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					className="size-11 shrink-0 sm:size-7 pointer-coarse:size-11"
					disabled={disabled}
					aria-label={t("settings.remoteAddLanAddress")}
					title={t("settings.remoteAddLanAddress")}
				>
					<Plus className="size-3.5" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="end"
				className="min-w-[220px] max-w-[calc(100vw-2rem)] overscroll-contain"
			>
				{result.status === "loading" ? (
					<div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
						<Spinner className="size-3.5" />
						<output>{t("common.loading")}</output>
					</div>
				) : result.status === "error" ? (
					<>
						<p
							role="alert"
							title={result.message}
							className="px-3 py-2 text-xs text-muted-foreground"
						>
							{t("settings.remoteLanAddressLoadFailed")}
						</p>
						<DropdownMenuItem
							className="min-h-11 sm:min-h-8"
							onSelect={(event) => {
								event.preventDefault();
								void load();
							}}
						>
							{t("common.retry")}
						</DropdownMenuItem>
					</>
				) : result.ips.length === 0 ? (
					<p className="px-3 py-2 text-xs text-muted-foreground">
						{t("settings.remoteLanAddressEmpty")}
					</p>
				) : (
					result.ips.map((ip) => {
						const baseUrl = new URL(`http://${ip}:${port}`).origin;
						const added = existingOrigins.has(baseUrl);
						return (
							<DropdownMenuItem
								key={ip}
								className="min-h-11 gap-3 sm:min-h-8"
								disabled={disabled || added}
								onSelect={() => onAdd(baseUrl)}
							>
								<span className="min-w-0 truncate font-mono text-xs">
									{baseUrl}
								</span>
								{added ? (
									<span className="ms-auto shrink-0 text-2xs text-muted-foreground">
										{t("common.added")}
									</span>
								) : null}
							</DropdownMenuItem>
						);
					})
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
