import App from "./App";
import { useLocale } from "./shared/lib/locale";

export default function AppRoot() {
	useLocale();
	return <App />;
}
