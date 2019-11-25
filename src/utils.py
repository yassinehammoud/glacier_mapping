import os
import math

import numpy as np
import cv2
import matplotlib.pyplot as plt


import rasterio
from rasterio.mask import mask as rasterio_mask


def crop_raster(raster_img, vector_data):
    vector_crs = rasterio.crs.CRS(vector_data.crs)
    if vector_crs != raster_img.meta['crs']:
        vector_data = vector_data.to_crs(raster_img.meta['crs'].data)

    mask = rasterio_mask(raster_img, list(vector_data.geometry), crop=False)[0]
    return mask


def get_snow_index(img, thresh=None):
    # channels first
    index = np.zeros_like(img[0])
    # for division by zero errors
    mask = (img[1, :, :] + img[4, :, :]) != 0
    values = (img[1, :, :] - img[4, :, :]) / (img[1, :, :] + img[4, :, :])
    index[mask] = values[mask]
    
    if thresh is not None:
        return index > thresh
    return index

def get_debris_glaciers(img, mask, thresh=0.6):
    snow_i = np.array(get_snow_index(img, thresh=thresh))
    mask = np.array(mask)
    debris_mask = np.zeros_like(mask)
    debris_mask[(snow_i == 0) & (mask == 1)] = 1

    return debris_mask


def merge_mask_snow_i(img, mask, thresh=0.6):
    snow_i = get_snow_index(img, thresh=thresh)
    hybrid_mask = np.zeros_like(mask)
    hybrid_mask[(snow_i == 1) & (mask == 1)] = 1
    hybrid_mask[(snow_i == 0) & (mask == 1)] = 2

    return hybrid_mask

def get_bg(mask):
    '''Adds extra channel to a mask to represent background,
       to make it one hot vector'''
    if len(mask.shape) == 2:
        fg = mask
    else:
        fg = np.logical_or.reduce(mask, axis=2)
    bg = np.logical_not(fg)
    
    return np.stack((fg, bg))

def get_mask(raster_img, vector_data, nan_value=0):
    # check if both have the same crs
    # follow the raster data as it's easier, faster
    # and doesn't involve saving huge new raster data
    vector_crs = rasterio.crs.CRS(vector_data.crs)
    if vector_crs != raster_img.meta['crs']:
        vector_data = vector_data.to_crs(raster_img.meta['crs'].data)

    mask = rasterio_mask(raster_img, list(vector_data.geometry), crop=False)[0]
    binary_mask = mask[0, :, :]
    binary_mask[np.isnan(binary_mask)] = nan_value
    binary_mask[binary_mask > 0] = 1

    return binary_mask


def slice_image(img, size=(512, 512)):
    if img.ndim == 2:
        h, w = img.shape
    else:
        h, w, _ = img.shape

    h_slices = math.ceil(h / size[0])
    w_slices = math.ceil(w / size[1])

    slices = []
    for i in range(h_slices):
        for j in range(w_slices):
            start_i, end_i = i * size[0], (i + 1) * size[0]
            start_j, end_j = j * size[1], (j + 1) * size[1]

            # the last tile need to be of the same size as well
            if end_i > h:
                start_i = -size[0]
            if end_j > w:
                start_j = -size[1]
            if img.ndim == 2:
                slices.append(img[start_i:end_i, start_j:end_j])
            else:
                slices.append(img[start_i:end_i, start_j:end_j, :])

    return slices


def display_sat_image(sat_img):
    plt.imshow(sat_rgb(sat_img))
    display_sat_bands(sat_img)


def sat_rgb(sat_img, indeces=(0, 1, 2), channel_first=False):
    if channel_first:
        sat_img = np.moveaxis(sat_img, 0, 2)
    rgb = np.stack([sat_img[:, :, indeces[0]],
                    sat_img[:, :, indeces[1]],
                    sat_img[:, :, indeces[2]]], 2).astype('int32')
    return rgb


def display_sat_bands(sat_img, bands=10, band_names=None, l7=True):
    cols = 5
    rows = int(bands/cols)
    fig, ax = plt.subplots(nrows=rows, ncols=cols, figsize=(30, int(30/rows)))
    if l7:
        band_names = ['Blue', 'Green', 'Red', 'Near infrared',
                      'Shortwave infrared 1', 'Low-gain Thermal Infrared',
                      'High-gain Thermal Infrared',
                      'Shortwave infrared 2', 'Panchromatic', 'BQA']
    elif band_names is None:
        band_names = [str(i + 1) for i in range(bands)]

    for i in range(rows):
        for j in range(cols):
            ax[i, j].imshow(sat_img[:, :, i * cols + j])
            ax[i, j].set_title('{} band'.format(
                band_names[i * cols + j]), size=20)
    fig.tight_layout()


def display_sat_mask(sat_img, mask, borders=None):
    rows = 1
    cols = 3 if borders is not None else 2

    fig, ax = plt.subplots(nrows=rows, ncols=cols, figsize=(30, int(30/rows)))

    ax[0].imshow(sat_rgb(sat_img))
    ax[0].title.set_text('RGB')
    ax[1].imshow(mask)
    ax[1].title.set_text('Binary Mask')
    if borders is not None:
        ax[2].imshow(borders)
        ax[2].title.set_text('Country Borders')

    fig.tight_layout()
    display_sat_bands(sat_img)
