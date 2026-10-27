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
import Experiments from "./pages/Experiments";
import RippleLab from "./pages/RippleLab";

export default function App() {
  return (
      <Routes>
        <Route path="ripple-lab" element={<RippleLab />} />
        <Route element={<LoginGate><Layout /></LoginGate>}>
          <Route index element={<Overview />} />
          <Route path="signals" element={<Signals />} />
          <Route path="data" element={<Data />} />
          <Route path="portfolio" element={<Portfolio />} />
          <Route path="research" element={<Research />} />
          <Route path="performance" element={<Performance />} />
          {/* legacy bookmark */}
          <Route path="backtest" element={<Performance />} />
          <Route path="lab" element={<Lab />} />
          <Route path="experiments" element={<Experiments />} />
          <Route path="experiments/:experimentId" element={<Experiments />} />
          <Route path="system" element={<System />} />
        </Route>
      </Routes>
  );
}
