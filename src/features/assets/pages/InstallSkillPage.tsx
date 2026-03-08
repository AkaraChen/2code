import {
	Box,
	Button,
	Flex,
	HStack,
	Input,
	InputGroup,
	Kbd,
	Stack,
	Text,
} from "@chakra-ui/react";
import * as m from "@/paraglide/messages.js";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { RiSearchLine } from "react-icons/ri";
import { useSkills } from "@/features/assets/hooks/useSkills";
import { SkillSearchResultList } from "../components/SkillSearchResultList";

export default function InstallSkillPage() {
	const [searchParams, setSearchParams] = useSearchParams();
	const query = searchParams.get("q") || "";
	const [inputValue, setInputValue] = useState(query);
	
	const { data: installedSkills } = useSkills();
	const installedNames = new Set(installedSkills.map((s) => s.name));
	const showResults = query.trim().length >= 2;

	const handleSearch = () => {
		if (inputValue.trim()) {
			setSearchParams({ q: inputValue });
		} else {
			setSearchParams({});
		}
	};

	return (
		<Flex
			direction="column"
			align={showResults ? "flex-start" : "center"}
			justify={showResults ? "flex-start" : "center"}
			minH={showResults ? "auto" : "50vh"}
			w="full"
			gap="6"
			pt={showResults ? "0" : "10vh"}
		>
			<Stack gap="6" w="full" align={showResults ? "flex-start" : "center"}>
				<Box w="full" maxW="lg">
					<HStack w="full">
						<InputGroup
							startElement={<RiSearchLine />}
							endElement={<Kbd size="sm">Enter</Kbd>}
							flex="1"
						>
						<Input
							placeholder={m.skillsSearchPlaceholder()}
							value={inputValue}
							onChange={(e) => setInputValue(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") handleSearch();
							}}
						/>
					</InputGroup>
					<Button
						onClick={handleSearch}
						disabled={inputValue.trim().length === 0}
					>
						{m.search()}
					</Button>
					</HStack>
				</Box>

				{showResults ? (
					<Box w="full" maxW="full">
						<SkillSearchResultList query={query} installedNames={installedNames} />
					</Box>
				) : (
					<Box textAlign="center">
						<Text color="fg.muted">{m.skillsEmptyDesc()}</Text>
					</Box>
				)}
			</Stack>
		</Flex>
	);
}
