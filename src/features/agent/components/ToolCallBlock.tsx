import { Box, Collapsible, Flex, Icon, Text } from "@chakra-ui/react";
import { useState } from "react";
import {
	LuChevronDown,
	LuChevronRight,
	LuFileText,
	LuPencil,
	LuTrash2,
	LuSearch,
	LuTerminal,
	LuBrain,
	LuDownload,
	LuMove,
	LuCircle,
} from "react-icons/lu";
import type { ToolCall } from "../types";
import { FileLocationsList } from "./FileLocationsList";
import { StatusBadge } from "./StatusBadge";
import { ToolCallContentRenderer } from "./ToolCallContentRenderer";

interface ToolCallBlockProps {
	toolCall: ToolCall;
}

export function ToolCallBlock({ toolCall }: ToolCallBlockProps) {
	// 确保有默认的 status
	const status = toolCall.status ?? "pending";

	// 失败的工具调用自动展开
	const [expanded, setExpanded] = useState(status === "failed");

	// 工具类型图标映射
	const kindIcon = {
		read: <LuFileText />,
		edit: <LuPencil />,
		delete: <LuTrash2 />,
		move: <LuMove />,
		search: <LuSearch />,
		execute: <LuTerminal />,
		think: <LuBrain />,
		fetch: <LuDownload />,
		switch_mode: <LuCircle />,
		other: <LuCircle />,
	};

	// 状态边框颜色
	const statusBorderColor = {
		pending: "gray.solid",
		in_progress: "blue.solid",
		completed: "green.solid",
		failed: "red.solid",
	};

	return (
		<Flex justify="flex-start" w="full">
			<Box maxW="80%" w="full">
				<Collapsible.Root
					open={expanded}
					onOpenChange={(e) => setExpanded(e.open)}
				>
					<Collapsible.Trigger asChild>
						<Flex
							px="3"
							py="2"
							bg="bg.muted"
							borderLeft="3px solid"
							borderColor={statusBorderColor[status]}
							borderRadius="md"
							cursor="pointer"
							align="center"
							gap="3"
							_hover={{ bg: "bg.subtle" }}
							transition="background 0.2s"
						>
							<Icon fontSize="md" color="fg.default">
								{kindIcon[toolCall.kind ?? "other"]}
							</Icon>
							<Text flex="1" fontSize="sm" fontWeight="medium">
								{toolCall.title ?? toolCall.kind ?? "Tool Call"}
							</Text>
							<StatusBadge status={status} />
							<Icon fontSize="xs" color="fg.muted">
								{expanded ? <LuChevronDown /> : <LuChevronRight />}
							</Icon>
						</Flex>
					</Collapsible.Trigger>

					<Collapsible.Content>
						<Box px="4" py="3" bg="bg.muted" borderRadius="md">
							{/* 文件位置 */}
							{toolCall.locations && toolCall.locations.length > 0 && (
								<FileLocationsList locations={toolCall.locations} />
							)}

							{/* 工具内容 */}
							{toolCall.content?.map((content, i) => (
								<ToolCallContentRenderer key={i} content={content} />
							))}

							{/* 原始输入/输出（仅在展开时显示） */}
							{expanded && (
								<>
									{toolCall.rawInput && (
										<Box mt="3">
											<Text
												fontSize="xs"
												fontWeight="medium"
												color="fg.muted"
												mb="1"
											>
												Input:
											</Text>
											<Box
												px="3"
												py="2"
												bg="bg.subtle"
												borderRadius="sm"
												fontSize="xs"
												fontFamily="mono"
												overflowX="auto"
											>
												<pre>
													{JSON.stringify(toolCall.rawInput, null, 2)}
												</pre>
											</Box>
										</Box>
									)}
									{toolCall.rawOutput && (
										<Box mt="3">
											<Text
												fontSize="xs"
												fontWeight="medium"
												color="fg.muted"
												mb="1"
											>
												Output:
											</Text>
											<Box
												px="3"
												py="2"
												bg="bg.subtle"
												borderRadius="sm"
												fontSize="xs"
												fontFamily="mono"
												overflowX="auto"
											>
												<pre>
													{JSON.stringify(toolCall.rawOutput, null, 2)}
												</pre>
											</Box>
										</Box>
									)}
								</>
							)}
						</Box>
					</Collapsible.Content>
				</Collapsible.Root>
			</Box>
		</Flex>
	);
}
