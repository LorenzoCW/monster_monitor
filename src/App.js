import React, { useEffect, useState } from 'react';
import { Line } from 'react-chartjs-2';
import 'chart.js/auto';
import './App.css';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.REACT_APP_API_KEY,
  authDomain: process.env.REACT_APP_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_PROJECT_ID,
  storageBucket: process.env.REACT_APP_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const PriceChart = () => {
  const [chartData, setChartData] = useState(null);
  const [currentPrices, setCurrentPrices] = useState({});

  // Mapeamento de cores para cada mercado
  const marketColorMap = {
    "Avenida": "#e6a820",
    "Central": "#2175db", // "#215eaa", - Cor original
    "Neto": "#b61414",
    "Open": "#9c1d9c"
  };

  useEffect(() => {
    const fetchData = async () => {
      const dataCollection = collection(db, "monster_data");
      const snapshot = await getDocs(dataCollection);

      const allDates = new Set();
      const rawData = [];

      // Coletar todos os dados e datas
      snapshot.forEach((doc) => {
        const docData = doc.data();
        rawData.push({ date: doc.id, data: docData });

        // Adicionar datas ao conjunto de datas únicas
        allDates.add(doc.id);
      });

      // Converter conjunto de datas únicas em um array ordenado
      const sortedDates = Array.from(allDates).sort((a, b) => new Date(a) - new Date(b));

      const priceData = {};

      // Inicializar os dados com null para cada data única
      rawData.forEach(({ date, data }) => {
        Object.keys(data).forEach((key) => {
          if (key.startsWith("preço_")) {
            const marketName = key.replace("preço_", "");
            if (!priceData[marketName]) {
              priceData[marketName] = sortedDates.map(() => null);
            }
            const dateIndex = sortedDates.indexOf(date);
            priceData[marketName][dateIndex] = data[key] || 0;
          }
        });
      });

      // Criar datasets
      const datasets = Object.keys(priceData).map((marketName) => {
        const color = marketColorMap[marketName] || "gray";
        return {
          label: marketName,
          data: priceData[marketName],
          borderColor: color,
          backgroundColor: `${color}33`,
          borderWidth: 2,
          pointRadius: 4,
          pointBackgroundColor: color,
        };
      });

      // Atualizar estado com os dados processados
      setChartData({
        labels: sortedDates,
        datasets,
      });

      // Definir os preços mais recentes
      const latestPrices = Object.keys(priceData).reduce((acc, marketName) => {
        acc[marketName] = priceData[marketName][priceData[marketName].length - 1];
        return acc;
      }, {});

      setCurrentPrices(latestPrices);
    };

    fetchData();
  }, []);

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
        position: 'top',
      },
    },
    scales: {
      x: {
        grid: {
          display: false,
        },
        ticks: {
          color: '#666',
        },
      },
      y: {
        grid: {
          borderDash: [5, 5],
        },
        ticks: {
          color: '#666',
        },
      },
    },
  };

  return (
    <div className="chart-container">
      <header className="chart-header">
        <h1>Monitor Monitor</h1>

        <div className="current-prices">
          {Object.keys(currentPrices).map((marketName) => (
            <p key={marketName} className="current-price" style={{ color: marketColorMap[marketName] }}>
              {`${marketName}:`}
              <p className="price-value">{`R$ ${currentPrices[marketName]?.toFixed(2) || "-"}`}</p>
            </p>
          ))}
        </div>
      </header>

      <div className="chart-wrapper">
        {chartData && <Line data={chartData} options={options} />}
      </div>
    </div>
  );
};

export default PriceChart;