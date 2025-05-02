import React, { useMemo, useEffect, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import type { ChartData, ChartOptions } from 'chart.js';
import './App.css';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_API_KEY,
  authDomain: import.meta.env.VITE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_APP_ID,
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

type PriceDataMap = Record<string, (number | null)[]>;
type CurrentPricesMap = Record<string, number | null>;
type ChangeIndicatorMap = Record<string, string>;
type LastPricesMap = Record<string, number | null>;

const App: React.FC = () => {
  const [chartData, setChartData] = useState<ChartData<'line', (number | null)[], string> | null>(null);
  const [currentPrices, setCurrentPrices] = useState<CurrentPricesMap>({});
  const [changeIndicators, setChangeIndicators] = useState<ChangeIndicatorMap>({});
  const [lastPrices, setLastPrices] = useState<LastPricesMap>({});
  const [hiddenMarkets, setHiddenMarkets] = useState<Set<string>>(new Set());

  // Colors for each market
  const marketColorMap = useMemo<Record<string, string>>(() => ({
    Avenida: '#e6a820',
    Central: '#2175db', // "#215eaa", - Original color
    Neto: '#b61414',
    Open: '#9c1d9c',
  }), []);

  useEffect(() => {
    const fetchData = async () => {
      // Fetch parsed month data
      const dataRef = doc(db, 'parsed_data', 'points_array');
      const dataSnap = await getDoc(dataRef);
      if (!dataSnap.exists()) return;

      const { month_data: monthData = {} } = dataSnap.data();
      const priceData: PriceDataMap = {};
      let sortedDates: string[] = [];
      const marketKeys = Object.keys(monthData).filter(key => key.startsWith('price_points_'));
      if (marketKeys.length > 0) {
        const firstPoints = (monthData[marketKeys[0]] as { x: string; y: number }[]) || [];
        sortedDates = firstPoints.map(p => p.x);
      }
      marketKeys.forEach(key => {
        const market = key.replace('price_points_', '');
        const points = (monthData[key] as { x: string; y: number }[]) || [];
        priceData[market] = sortedDates.map(date => {
          const match = points.find(p => p.x === date);
          return match ? match.y : null;
        });
      });

      // Fetch calcs data
      const calcsRef = doc(db, 'parsed_data', 'calcs');
      const calcsSnap = await getDoc(calcsRef);
      const indicators: ChangeIndicatorMap = {};
      const lasts: LastPricesMap = {};
      if (calcsSnap.exists()) {
        const calcsData = calcsSnap.data();
        Object.keys(priceData).forEach(market => {
          const key = `${market}_changes`;
          const changeObj = calcsData[key] as { change_indicator?: string; last_price?: number };
          indicators[market] = changeObj?.change_indicator ?? '';
          lasts[market] = changeObj?.last_price ?? null;
        });
      }

      // Sort markets alphabetically
      const sortedMarkets = Object.keys(priceData).sort();
      // Build datasets
      const datasets = sortedMarkets.map(market => ({
        label: market,
        data: priceData[market],
        borderColor: marketColorMap[market] ?? 'gray',
        backgroundColor: `${marketColorMap[market] ?? 'gray'}33`,
        borderWidth: 2,
        pointRadius: 4,
        pointBackgroundColor: marketColorMap[market] ?? 'gray',
        hidden: hiddenMarkets.has(market),
      }));

      setChartData({ labels: sortedDates, datasets });
      // Current prices from data array
      const current: CurrentPricesMap = {};
      sortedMarkets.forEach(market => {
        const vals = priceData[market];
        current[market] = vals[vals.length - 1] ?? null;
      });

      setCurrentPrices(current);
      setChangeIndicators(indicators);
      setLastPrices(lasts);
    };

    fetchData();
  }, [hiddenMarkets, marketColorMap]);

  const toggleMarketVisibility = (market: string) => {
    setHiddenMarkets(prev => {
      const next = new Set(prev);
      next.has(market) ? next.delete(market) : next.add(market);
      return next;
    });
  };

  // Alphabetical markets ordering
  const sortedMarkets = Object.keys(currentPrices).sort();
  // Determine which market to highlight using lastPrices
  const highlightMarket = sortedMarkets.reduce((prev, market) => {
    const price = lastPrices[market] ?? Infinity;
    const prevPrice = prev ? (lastPrices[prev] ?? Infinity) : Infinity;
    return price < prevPrice ? market : prev;
  }, '');

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false, position: 'top' } },
    hover: { mode: 'nearest', intersect: false },
    scales: {
      x: { grid: { display: false }, ticks: { color: '#666' } },
      y: { grid: { display: false }, ticks: { color: '#666' } },
    },
    elements: { point: { hitRadius: 10, hoverRadius: 10 } },
  };

  return (
    <div className="chart-container">
      <header className="chart-header">
        <h1>Monster Monitor</h1>
        <div className="current-prices">
          {sortedMarkets.map(market => {
            const price = currentPrices[market];
            const last = lastPrices[market];
            return (
              <div
                key={market}
                className="current-price"
                style={{ color: marketColorMap[market], cursor: 'pointer' }}
                onClick={() => toggleMarketVisibility(market)}
              >
                <span>{`${market}: `}</span>
                <div
                  className="price-value"
                  style={{
                    fontWeight: market === highlightMarket ? 'bold' : 'normal',
                    color: market === highlightMarket ? '#a4cf39' : '#cccccc',
                  }}
                >
                  <span className="indicator">
                    {changeIndicators[market] ? `${changeIndicators[market]} ` : ''}
                  </span>
                  {last !== null ? `R$ ${last.toFixed(2)}` : price !== null ? `R$ ${price.toFixed(2)}` : '-'}
                </div>
              </div>
            );
          })}
        </div>
      </header>
      <div className="chart-wrapper">
        {chartData && <Line data={chartData} options={options} />}
      </div>
    </div>
  );
};

export default App;
