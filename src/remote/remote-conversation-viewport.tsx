import {
	memo,
	useMemo,
	useSyncExternalStore,
	type ComponentProps,
} from "react";

import { ChatConversationViewport } from "@/components/chat/chat-conversation-viewport";
import type { ChatConversationStore } from "@/components/chat/chat-conversation-store";
import { createConversationState } from "@/lib/conversation-reducer";
import type { ChatMessage } from "@/lib/conversation-types";

const EMPTY_CONVERSATION = createConversationState();

type Props = Omit<
	ComponentProps<typeof ChatConversationViewport>,
	"messages" | "activeAssistantMessageId"
> & {
	conversationStore: ChatConversationStore;
	historyPrefix: ChatMessage[];
	initialVirtualizerMessageCount?: number;
};

export const RemoteConversationViewport = memo(
	function RemoteConversationViewport({
		conversationStore,
		historyPrefix,
		initialVirtualizerCache,
		initialVirtualizerMessageCount,
		...props
	}: Props) {
		const conversation =
			useSyncExternalStore(
				conversationStore.subscribe,
				conversationStore.getSnapshot,
				conversationStore.getSnapshot,
			) ?? EMPTY_CONVERSATION;
		const messages = useMemo(
			() =>
				historyPrefix.length > 0
					? [...historyPrefix, ...conversation.messages]
					: conversation.messages,
			[conversation.messages, historyPrefix],
		);
		return (
			<ChatConversationViewport
				{...props}
				messages={messages}
				activeAssistantMessageId={
					conversation.active?.assistantMessageId ?? null
				}
				initialVirtualizerCache={
					initialVirtualizerMessageCount === messages.length
						? initialVirtualizerCache
						: undefined
				}
			/>
		);
	},
);
