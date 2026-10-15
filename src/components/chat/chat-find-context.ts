import { createContext, useContext } from "react";

import type { ChatMessageMatch } from "@/lib/chat-message-search";

export const ChatFindMatchContext = createContext<ChatMessageMatch | null>(
	null,
);

export function useChatFindMatch(messageId: string) {
	const match = useContext(ChatFindMatchContext);
	return match?.messageId === messageId ? match : null;
}
