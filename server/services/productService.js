'use strict';

const { collection: getCollection, newId } = require('../config/db');
const { ApiError } = require('../middleware/errorHandler');

const COLLECTION = 'products';

function collection() {
  return getCollection(COLLECTION);
}

function toIso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toPublicProduct(data) {
  return {
    id: data._id,
    name: data.name,
    description: data.description || '',
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
}

async function findOrThrow(id) {
  const doc = await collection().findOne({ _id: String(id) });
  if (!doc) throw new ApiError(404, 'Product not found', 'PRODUCT_NOT_FOUND');
  return doc;
}

/** Product names identify licenses during verification, so they must be unique. */
async function assertNameAvailable(name, exceptId) {
  const all = await collection().find({}, { projection: { name: 1 } }).toArray();
  const clash = all.find(
    (doc) =>
      doc._id !== exceptId &&
      String(doc.name || '').trim().toLowerCase() === name.trim().toLowerCase()
  );
  if (clash) {
    throw new ApiError(409, 'A product with that name already exists', 'PRODUCT_NAME_TAKEN');
  }
}

async function createProduct({ name, description }) {
  await assertNameAvailable(name);
  const now = new Date();
  const doc = {
    _id: newId(),
    name,
    description: description || '',
    createdAt: now,
    updatedAt: now,
  };
  await collection().insertOne(doc);
  return toPublicProduct(doc);
}

async function listProducts() {
  const docs = await collection().find().sort({ createdAt: -1 }).toArray();
  return docs.map(toPublicProduct);
}

async function getProductById(id) {
  return toPublicProduct(await findOrThrow(id));
}

async function updateProduct(id, { name, description }) {
  await findOrThrow(id);

  const updates = { updatedAt: new Date() };
  if (name !== undefined) {
    await assertNameAvailable(name, id);
    updates.name = name;
  }
  if (description !== undefined) updates.description = description;

  const doc = await collection().findOneAndUpdate(
    { _id: id },
    { $set: updates },
    { returnDocument: 'after' }
  );
  return toPublicProduct(doc);
}

async function deleteProduct(id) {
  const doc = await findOrThrow(id);

  // Licenses are matched against the product name during verification, so
  // deleting a product that licenses still reference would silently break them.
  const inUse = await getCollection('licenses').findOne(
    { productName: doc.name },
    { projection: { _id: 1 } }
  );

  if (inUse) {
    throw new ApiError(
      409,
      'This product still has licenses issued against it. Delete those licenses first.',
      'PRODUCT_IN_USE'
    );
  }

  await collection().deleteOne({ _id: id });
  return { id };
}

module.exports = {
  COLLECTION,
  createProduct,
  listProducts,
  getProductById,
  updateProduct,
  deleteProduct,
};
