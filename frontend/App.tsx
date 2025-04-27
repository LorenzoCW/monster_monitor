import React, { useMemo, useEffect, useState } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, } from 'chart.js';
import { Line } from 'react-chartjs-2';
import type { ChartData, ChartOptions } from 'chart.js';
import './App.css';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

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

const App: React.FC = () => {
  const [chartData, setChartData] = useState<ChartData<'line', (number | null)[], string> | null>(null);
  const [currentPrices, setCurrentPrices] = useState<CurrentPricesMap>({});
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
      const dataCollection = collection(db, 'monster_data');
      const snapshot = await getDocs(dataCollection);

      const dates = new Set<string>();
      const raw: { date: string; data: Record<string, any> }[] = [];

      snapshot.forEach(doc => {
        const data = doc.data();
        raw.push({ date: doc.id, data });
        dates.add(doc.id);
      });

      const sortedDates = Array.from(dates).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
      const priceData: PriceDataMap = {};

      raw.forEach(({ date, data }) => {
        Object.entries(data).forEach(([key, value]) => {
          if (key.startsWith('preço_')) {
            const market = key.replace('preço_', '');
            if (!priceData[market]) priceData[market] = Array(sortedDates.length).fill(null);
            const idx = sortedDates.indexOf(date);
            priceData[market][idx] = value ?? null;
          }
        });
      });

      const datasets = Object.entries(priceData).map(([market, values]) => {
        const color = marketColorMap[market] ?? 'gray';
        return {
          label: market,
          data: values,
          borderColor: color,
          backgroundColor: `${color}33`,
          borderWidth: 2,
          pointRadius: 4,
          pointBackgroundColor: color,
          hidden: hiddenMarkets.has(market),
        };
      });

      setChartData({ labels: sortedDates, datasets });

      const latest: CurrentPricesMap = {};
      Object.entries(priceData).forEach(([market, values]) => {
        latest[market] = values[values.length - 1] ?? null;
      });
      setCurrentPrices(latest);
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

  const numericPrices = Object.values(currentPrices).map(v => (v === null ? Infinity : v));
  const minPrice = Math.min(...numericPrices);

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false, position: 'top' } },
    hover: { mode: 'nearest', intersect: false },
    scales: {
      x: { grid: { display: false }, ticks: { color: '#666' } },
      // y: { grid: { dash: [5, 5] }, ticks: { color: '#666' } },
      y: { grid: { display: false }, ticks: { color: '#666' } },
    },
    elements: { point: { hitRadius: 10, hoverRadius: 10 } },
  };

  return (
    <div className="chart-container">
      <header className="chart-header">
        <h1>Monster Monitor</h1>
        <div className="current-prices">
          {Object.entries(currentPrices).map(([market, price]) => (
            <div
              key={market}
              className="current-price"
              style={{ color: marketColorMap[market], cursor: 'pointer' }}
              onClick={() => toggleMarketVisibility(market)}
            >
              <span>{`${market}: `}</span>
              <span
                className="price-value"
                style={{
                  fontWeight: price === minPrice ? 'bold' : 'normal',
                  color: price === minPrice ? '#a4cf39' : '#cccccc',
                }}
              >
                {price !== null ? `R$ ${price.toFixed(2)}` : '-'}
              </span>
            </div>
          ))}
        </div>
      </header>
      <div className="chart-wrapper">
        {chartData && <Line data={chartData} options={options} />}
      </div>
    </div>
  );
};

export default App;
