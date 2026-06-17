import { Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Overview from "./pages/Overview";
import Signals from "./pages/Signals";
import Portfolio from "./pages/Portfolio";
import Research from "./pages/Research";
import Data from "./pages/Data";
import Backtest from "./pages/Backtest";
import System from "./pages/System";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Overview />} />
        <Route path="signals" element={<Signals />} />
        <Route path="data" element={<Data />} />
        <Route path="portfolio" element={<Portfolio />} />
        <Route path="research" element={<Research />} />
        <Route path="backtest" element={<Backtest />} />
        <Route path="system" element={<System />} />
      </Route>
    </Routes>
  );
}
