import requests
import pandas as pd

# Stanford coordinates
LAT = 37.4275
LON = -122.1697

# Date range
START = "20170301"
END = "20191031"

# Parameters (important ones for solar forecasting)
PARAMS = ",".join([
    "T2M",                 # temperature
    "RH2M",                # humidity
    "PS",                  # pressure
    "WS2M",                # wind speed
    "WD2M",                # wind direction
    "PRECTOTCORR",         # precipitation
    "ALLSKY_SFC_SW_DWN"    # solar radiation
])

# API URL
url = f"https://power.larc.nasa.gov/api/temporal/hourly/point?parameters={PARAMS}&community=RE&longitude={LON}&latitude={LAT}&start={START}&end={END}&format=JSON"

# Request
response = requests.get(url)
data = response.json()

# Extract data
weather_data = data["properties"]["parameter"]

# Convert to DataFrame
df_weather = pd.DataFrame(weather_data)

# Reset index (timestamp is index here)
df_weather = df_weather.reset_index()

# Rename timestamp column
df_weather = df_weather.rename(columns={"index": "timestamp"})

# Convert timestamp format
df_weather["timestamp"] = pd.to_datetime(df_weather["timestamp"], format="%Y%m%d%H")

# IMPORTANT: NASA data is in UTC → convert to California time
df_weather["timestamp"] = df_weather["timestamp"].dt.tz_localize("UTC")
df_weather["timestamp"] = df_weather["timestamp"].dt.tz_convert("America/Los_Angeles")

# Set index
df_weather = df_weather.set_index("timestamp")

# Save to CSV
df_weather.to_csv("weather_stanford_2017_2019.csv")

# Preview
print(df_weather.head())
print(df_weather.index.min(), df_weather.index.max())