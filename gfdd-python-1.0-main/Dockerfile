# Builder Stage
FROM python:3.9 as builder

# Set the working directory
WORKDIR /app

# Install build dependencies for Python packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Create and activate virtual environment
ENV VIRTUAL_ENV=/opt/venv
RUN python3 -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt uvicorn

# Final Stage
FROM python:3.9-slim

# Set the working directory
WORKDIR /app

# Install Tesseract and other tools, download models, and clean up in a single layer
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    exiftool \
    wget \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# Set Tesseract data path
ENV TESSDATA_PREFIX=/usr/share/tesseract-ocr/5.00/tessdata

# Download and install Tesseract language models
RUN mkdir -p $TESSDATA_PREFIX \
    && wget -O $TESSDATA_PREFIX/eng.traineddata https://github.com/tesseract-ocr/tessdata_best/raw/main/eng.traineddata \
    && wget -O $TESSDATA_PREFIX/osd.traineddata https://github.com/tesseract-ocr/tessdata_best/raw/main/osd.traineddata \
    && wget -O $TESSDATA_PREFIX/chi_sim.traineddata https://github.com/tesseract-ocr/tessdata_best/raw/main/chi_sim.traineddata \
    && wget -O $TESSDATA_PREFIX/chi_tra.traineddata https://github.com/tesseract-ocr/tessdata_best/raw/main/chi_tra.traineddata

# Copy the virtual environment from the builder stage
COPY --from=builder /opt/venv /opt/venv

# Activate the virtual environment
ENV PATH="/opt/venv/bin:$PATH"

# Copy the application code
COPY . .

# Create symbolic link for tessdata_best directory
RUN mkdir -p Tesseract-OCR && \
    ln -s $TESSDATA_PREFIX Tesseract-OCR/tessdata_best

# Make exiftool executable
RUN chmod a+x pyexiftool/exiftool/linux/exiftool

# Expose the port the app runs on
EXPOSE 8000

# Command to run the application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
