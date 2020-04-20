import { Express } from 'express';
import fs from 'fs';
import path from 'path';
import csv from 'csv-parse';
import { getCustomRepository, getRepository, In } from 'typeorm';

import AppError from '../errors/AppError';
import Transaction from '../models/Transaction';
import Category from '../models/Category';
import TransactionsRepository from '../repositories/TransactionsRepository';

interface Request {
  file: Express.Multer.File;
}

interface Response {
  title: string;
  type: 'income' | 'outcome';
  value: number;
  category: string;
}

class ImportTransactionsService {
  async execute({ file }: Request): Promise<Transaction[]> {
    const transactionsFile: Response[] = [];
    const categories: string[] = [];
    const transactionsRepository = getCustomRepository(TransactionsRepository);
    const categoriesRepository = getRepository(Category);

    const fileExists = await fs.promises.stat(file.path);
    const extension = path.extname(file.originalname);

    if (!fileExists) {
      throw new AppError('This file does not exist.');
    }

    if (extension !== '.csv') {
      throw new AppError('Only .csv file are allowed.');
    }

    const readStream = fs.createReadStream(file.path).pipe(
      csv({
        from_line: 2,
      }).on('data', async data => {
        const [title, type, value, category] = data.map((cell: string) =>
          cell.trim(),
        );

        const transaction = {
          title,
          type,
          value,
          category,
        };

        categories.push(category);
        transactionsFile.push(transaction);
      }),
    );

    await new Promise(resolve => readStream.on('end', resolve));

    const categoriesExistent = await categoriesRepository.find({
      where: { title: In(categories) },
    });

    const categoriesTitles = categoriesExistent.map(
      (category: Category) => category.title,
    );

    const addCategories = categories
      .filter(category => !categoriesTitles.includes(category))
      .filter((value, index, arr) => arr.indexOf(value) === index);

    const createCategories = categoriesRepository.create(
      addCategories.map(title => ({
        title,
      })),
    );

    if (createCategories) {
      await categoriesRepository.save(createCategories);
    }

    const allCategories = [...createCategories, ...categoriesExistent];

    const transactions = transactionsRepository.create(
      transactionsFile.map(transactionFile => ({
        title: transactionFile.title,
        type: transactionFile.type,
        value: transactionFile.value,
        category: allCategories.find(
          category => category.title === transactionFile.category,
        ),
      })),
    );

    await transactionsRepository.save(transactions);

    await fs.promises.unlink(file.path);

    return transactions;
  }
}
export default ImportTransactionsService;
