import { Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import LoginGate from "./components/LoginGate";
import Overview from "./pages/Overview";
import Signals from "./pages/Signals";
import Portfolio from "./pages/Portfolio";
import Research from "./pages/Research";
import Data from "./pages/Data";
import Performance from "./pages/Performance";
import Lab from "./pages/Lab";
import System from "./pages/System";

export default function App() {
  return (
    <LoginGate>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Overview />} />
          <Route path="signals" element={<Signals />} />
          <Route path="data" element={<Data />} />
          <Route path="portfolio" element={<Portfolio />} />
          <Route path="research" element={<Research />} />
          <Route path="performance" element={<Performance />} />
          {/* legacy bookmark */}
          <Route path="backtest" element={<Performance />} />
          <Route path="lab" element={<Lab />} />
          <Route path="system" element={<System />} />
        </Route>
      </Routes>
    </LoginGate>
  );
}
