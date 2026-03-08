import {
	Box,
	Button,
	Flex,
	HStack,
	Input,
	InputGroup,
	Kbd,
	Link,
	Stack,
	Text,
} from "@chakra-ui/react";
import * as m from "@/paraglide/messages.js";
import { useState } from "react";
import { Link as RouterLink, useSearchParams } from "react-router";
import { RiSearchLine } from "react-icons/ri";
import { useSkills } from "@/features/assets/hooks/useSkills";
import { SkillSearchResultList } from "../components/SkillSearchResultList";

function SkillsLogo() {
	return (
		<HStack gap="3" align="center" mb="6">
			<Link
				aria-label="Made with love by Vercel"
				href="https://vercel.com"
				target="_blank"
				display="flex"
				alignItems="center"
			>
				<svg
					height="27"
					strokeLinejoin="round"
					viewBox="0 0 16 16"
					width="27"
					style={{ color: "currentColor" }}
				>
					<path
						fillRule="evenodd"
						clipRule="evenodd"
						d="M8 1L16 15H0L8 1Z"
						fill="currentColor"
					/>
				</svg>
			</Link>
			<Box color="fg.muted" display="flex" alignItems="center">
				<svg
					height="24"
					strokeLinejoin="round"
					viewBox="0 0 16 16"
					width="24"
					style={{ color: "currentColor" }}
				>
					<path
						fillRule="evenodd"
						clipRule="evenodd"
						d="M4.01526 15.3939L4.3107 14.7046L10.3107 0.704556L10.6061 0.0151978L11.9849 0.606077L11.6894 1.29544L5.68942 15.2954L5.39398 15.9848L4.01526 15.3939Z"
						fill="currentColor"
					/>
				</svg>
			</Box>
			<Link asChild _hover={{ textDecoration: "none" }}>
				<RouterLink to="/assets/skills">
					<Text fontWeight="medium" letterSpacing="tight" fontSize="3xl">
						Skills
					</Text>
				</RouterLink>
			</Link>
		</HStack>
	);
}

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
				<SkillsLogo />
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
