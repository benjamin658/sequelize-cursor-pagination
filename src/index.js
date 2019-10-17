const Sequelize = require('sequelize');
const base64 = require('base-64');

const { Op } = Sequelize;

function decodeCursor(cursor) {
  return cursor ? JSON.parse(base64.decode(cursor)) : null;
}

function encodeCursor(cursor) {
  return base64.encode(JSON.stringify(cursor));
}

function getPaginationQuery(cursor, cursorOrderOperator, paginationField, primaryKeyField) {
  if (paginationField !== primaryKeyField) {
    return {
      [Op.or]: [
        {
          [paginationField]: {
            [cursorOrderOperator]: cursor[0],
          },
        },
        {
          [paginationField]: cursor[0],
          [primaryKeyField]: {
            [cursorOrderOperator]: cursor[1],
          },
        },
      ],
    };
  } else {
    return {
      [paginationField]: {
        [cursorOrderOperator]: cursor[0],
      },
    };
  }
}

function withPagination({ methodName = 'paginate', primaryKeyField = 'id' } = {}) {
  return model => {
    const paginate = ({
      where = {},
      attributes = [],
      include = [],
      limit, before,
      after,
      desc = false,
      paginationField = primaryKeyField,
      rowCount = false,
      indexHints,
    }) => {
      const decodedBefore = !!before ? decodeCursor(before) : null;
      const decodedAfter = !!after ? decodeCursor(after) : null;
      const cursorOrderIsDesc = before ? !desc : desc;
      const cursorOrderOperator = cursorOrderIsDesc ? Op.lt : Op.gt;
      const paginationFieldIsNonId = paginationField !== primaryKeyField;

      let paginationQuery;

      if (before) {
        paginationQuery = getPaginationQuery(decodedBefore, cursorOrderOperator, paginationField, primaryKeyField);
      } else if (after) {
        paginationQuery = getPaginationQuery(decodedAfter, cursorOrderOperator, paginationField, primaryKeyField);
      }

      const whereQuery = paginationQuery
        ? { [Op.and]: [paginationQuery, where] }
        : where;

      // Dynamic load query method by rowCount condition.
      return model[rowCount ? 'findAndCountAll' : 'findAll']({
        where: whereQuery,
        include,
        limit: limit + 1,
        order: [
          cursorOrderIsDesc ? [paginationField, 'DESC'] : paginationField,
          ...(paginationFieldIsNonId ? [primaryKeyField] : []),
        ],
        ...(typeof indexHints !== 'undefined') ? { indexHints } : {},
        ...(Array.isArray(attributes) && attributes.length) ? { attributes } : {},
      }).then(queryResults => {
        const results = (rowCount) ? queryResults.rows : queryResults;
        const hasMore = results.length > limit;

        if (hasMore) {
          results.pop();
        }

        if (before) {
          results.reverse();
        }

        const hasNext = !!before || hasMore;
        const hasPrevious = !!after || (!!before && hasMore);

        let beforeCursor = null;
        let afterCursor = null;

        if (results.length > 0) {
          beforeCursor = paginationFieldIsNonId
            ? encodeCursor([results[0][paginationField], results[0][primaryKeyField]])
            : encodeCursor([results[0][paginationField]]);

          afterCursor = paginationFieldIsNonId
            ? encodeCursor([results[results.length - 1][paginationField], results[results.length - 1][primaryKeyField]])
            : encodeCursor([results[results.length - 1][paginationField]]);
        }

        return {
          results,
          ...rowCount ? { count: queryResults.count } : { count: null },
          cursors: {
            hasNext,
            hasPrevious,
            before: beforeCursor,
            after: afterCursor,
          },
        };
      });
    };

    model[methodName] = paginate;
  };
}

module.exports = withPagination;